'use client';

import { useState, useRef } from 'react';
import { BillData } from '@/lib/bill-processor';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { ThemeToggle } from '@/components/theme-toggle';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FolderOpen, Play, Square, Download, FileText, X, Pencil, Save, Receipt, FolderSearch, FileQuestion, Loader2, Trash2, Maximize2, Minimize2 } from 'lucide-react';

interface FileMetadata {
  id: string;
  name: string;
  mimeType: string;
  createdTime?: string;
  modifiedTime?: string;
  link: string;
}

export default function Home() {
  const [folderLink, setFolderLink] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [scannedFiles, setScannedFiles] = useState<FileMetadata[]>([]);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [bills, setBills] = useState<BillData[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [shouldStop, setShouldStop] = useState(false);
  const stopRef = useRef(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, message: '', step: '' });
  const [error, setError] = useState('');
  const [failedFiles, setFailedFiles] = useState<{ link: string; message: string }[]>([]);
  const [excelFileName, setExcelFileName] = useState('bills');
  const [excelColumns, setExcelColumns] = useState({
    date: true,
    category: true,
    vendor: true,
    description: true,
    amount: true,
    currency: true,
    receipt: true,
  });
  const [editingBill, setEditingBill] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Partial<BillData>>({});
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFilesMaximized, setIsFilesMaximized] = useState(false);

  const handleScanFolder = async () => {
    setScanning(true);
    setError('');
    setScannedFiles([]);

    try {
      const response = await fetch('/api/scan-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          folderLink,
          startDate: startDate ? `${startDate}T00:00:00Z` : undefined,
          endDate: endDate ? `${endDate}T23:59:59Z` : undefined,
        }),
      });

      const scanData = await response.json();

      if (!response.ok) {
        throw new Error(scanData.error || 'Failed to scan folder');
      }

      if (!scanData.files || scanData.files.length === 0) {
        setError('No supported files found in the folder for the selected date range.');
        setScanning(false);
        return;
      }

      setScannedFiles(scanData.files);
      setSelectedFileIds(new Set(scanData.files.map((f: FileMetadata) => f.id)));
      setScanning(false);

    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setScanning(false);
    }
  };

  const handleProcessFiles = async () => {
    const selectedFiles = scannedFiles.filter(f => selectedFileIds.has(f.id));
    const fileLinks = selectedFiles.map(f => f.link);
    processFiles(fileLinks);
  };

  const processFiles = async (fileLinks: string[]) => {
    setLoading(true);
    setShouldStop(false);
    stopRef.current = false;
    setBills([]);
    setFailedFiles([]);
    setProgress({ current: 0, total: fileLinks.length, message: 'Starting...', step: '' });

    try {
      const response = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driveLinks: fileLinks }),
      });

      if (!response.body) return;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        if (stopRef.current) {
          await reader.cancel();
          break;
        }
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.replace('data: ', '');
            try {
              const event = JSON.parse(jsonStr);

              if (event.type === 'progress') {
                setProgress({ 
                  current: event.current, 
                  total: event.total,
                  message: event.message || 'Processing...',
                  step: event.step || '',
                });
              } else if (event.type === 'bill') {
                setBills((prev) => [...prev, event.data]);
              } else if (event.type === 'error') {
                console.error(`Error processing ${event.link}:`, event.message);
                setFailedFiles((prev) => [...prev, { link: event.link, message: event.message }]);
              } else if (event.type === 'complete') {
                console.log('Processing complete');
              }
            } catch (e) {
              console.error('Error parsing event:', e);
            }
          }
        }
      }
    } catch (err: unknown) {
      console.error('Extraction error:', err);
      setError('An error occurred while processing bills.');
    } finally {
      setLoading(false);
    }
  };

  const handleStartEdit = (bill: BillData) => {
    setEditingBill(bill.id);
    setEditValues(bill);
  };

  const handleSaveEdit = () => {
    if (editingBill && editValues) {
      setBills((prev) =>
        prev.map((bill) =>
          bill.id === editingBill ? { ...bill, ...editValues } : bill
        )
      );
      setEditingBill(null);
      setEditValues({});
    }
  };

  const handleCancelEdit = () => {
    setEditingBill(null);
    setEditValues({});
  };

  const handleDelete = (id: string) => {
    setBills((prev) => prev.filter((bill) => bill.id !== id));
  };

  const handleExport = async () => {
    try {
      const response = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bills, columns: excelColumns }),
      });

      if (!response.ok) throw new Error('Failed to export');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const fileName = excelFileName.trim() || 'bills';
      a.download = `${fileName}-${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error('Export error:', err);
      setError('Failed to export Excel file.');
    }
  };

  const totalAmount = bills.reduce((sum, bill) => sum + (Number(bill.amount) || 0), 0);

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 relative">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Bill Scraper</h1>
          <p className="text-muted-foreground">AI-powered expense extraction</p>
        </div>
        <ThemeToggle />
      </div>

      {/* Bento Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        
        {/* Left Column - Input & Files */}
        <div className="lg:col-span-3 space-y-4">
          
          {/* Folder Input */}
          <Card className="h-fit">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <FolderOpen className="h-5 w-5" />
                Folder Scan
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label htmlFor="folder">Drive Folder Link</Label>
                <Input 
                  id="folder"
                  value={folderLink}
                  onChange={(e) => setFolderLink(e.target.value)}
                  placeholder="https://drive.google.com/drive/folders/..."
                  className="mt-1"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="start">From Date</Label>
                  <Input 
                    id="start"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="end">To Date</Label>
                  <Input 
                    id="end"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="mt-1"
                  />
                </div>
              </div>
              <Button 
                onClick={handleScanFolder}
                disabled={loading || scanning || !folderLink}
                className="w-full"
              >
                {scanning ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Scanning...
                  </>
                ) : (
                  <>
                    <FolderSearch className="h-4 w-4 mr-2" />
                    Scan Folder
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Files Preview */}
          <Card className={isFilesMaximized ? 'fixed inset-4 z-50 bg-background transition-all duration-300' : 'h-[calc(100vh-420px)] transition-all duration-300'}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Files {scannedFiles.length > 0 && `(${selectedFileIds.size}/${scannedFiles.length})`}</CardTitle>
                <div className="flex items-center gap-2">
                  {scannedFiles.length > 0 && (
                    <Button 
                      variant="ghost"
                      size="icon"
                      onClick={() => setIsFilesMaximized(!isFilesMaximized)}
                      className="h-8 w-8"
                    >
                      {isFilesMaximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                    </Button>
                  )}
                  {scannedFiles.length > 0 && (
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => {
                        if (selectedFileIds.size === scannedFiles.length) {
                          setSelectedFileIds(new Set());
                        } else {
                          setSelectedFileIds(new Set(scannedFiles.map(f => f.id)));
                        }
                      }}
                    >
                      {selectedFileIds.size === scannedFiles.length ? 'Deselect All' : 'Select All'}
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className={`overflow-auto transition-all duration-300 ${isFilesMaximized ? 'h-[calc(100%-80px)]' : 'h-[calc(100%-140px)]'}`}>
              {scannedFiles.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                  <FileQuestion className="h-16 w-16 mb-4 opacity-20" />
                  <p className="text-sm text-center">No files scanned yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {scannedFiles.map((file) => (
                    <div key={file.id} className="flex items-start gap-2 p-2 rounded-lg border hover:bg-accent transition-colors">
                      <Checkbox
                        checked={selectedFileIds.has(file.id)}
                        onCheckedChange={(checked) => {
                          const newSelected = new Set(selectedFileIds);
                          if (checked) {
                            newSelected.add(file.id);
                          } else {
                            newSelected.delete(file.id);
                          }
                          setSelectedFileIds(newSelected);
                        }}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{file.name}</p>
                        {file.createdTime && (
                          <p className="text-xs text-muted-foreground">
                            {new Date(file.createdTime).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
            {scannedFiles.length > 0 && (
              <div className="p-4 border-t">
                <Button 
                  onClick={handleProcessFiles}
                  disabled={loading || selectedFileIds.size === 0}
                  className="w-full"
                >
                  <Play className="h-4 w-4 mr-2" />
                  Process {selectedFileIds.size} File{selectedFileIds.size !== 1 ? 's' : ''}
                </Button>
              </div>
            )}
          </Card>
        </div>

        {/* Middle & Right Column - Progress & Bills Table */}
        <div className="lg:col-span-9 space-y-4">
          
          {/* Progress */}
          {loading && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Processing
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span>{progress.message}</span>
                  <span className="font-medium">{progress.current}/{progress.total}</span>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%` }}
                  />
                </div>
                <Button 
                  variant="destructive" 
                  size="icon"
                  onClick={() => {
                    setShouldStop(true);
                    stopRef.current = true;
                  }}
                  disabled={shouldStop}
                  className="h-8 w-8"
                >
                  <Square className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Export Settings */}
          {!isMaximized && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Export Settings
                </CardTitle>
              </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="filename">File Name</Label>
                  <Input 
                    id="filename"
                    value={excelFileName}
                    onChange={(e) => setExcelFileName(e.target.value)}
                    placeholder="bills"
                    className="mt-1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {excelFileName.trim() || 'bills'}-{new Date().toISOString().split('T')[0]}.xlsx
                  </p>
                </div>

                <div>
                  <Label className="text-sm font-medium mb-2 block">Columns to Export</Label>
                  <div className="flex flex-wrap gap-3 mt-1">
                    {Object.entries(excelColumns).map(([key, value]) => (
                      <div key={key} className="flex items-center space-x-2">
                        <Checkbox
                          id={key}
                          checked={value}
                          onCheckedChange={(checked) => 
                            setExcelColumns(prev => ({ ...prev, [key]: !!checked }))
                          }
                        />
                        <label
                          htmlFor={key}
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 capitalize cursor-pointer"
                        >
                          {key.replace('_', ' ')}
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
          )}

          {/* Bills Table */}
          <Card className={isMaximized ? 'fixed inset-4 z-50 bg-background transition-all duration-300' : 'h-[400px] transition-all duration-300'}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg">Extracted Bills {bills.length > 0 && `(${bills.length})`}</CardTitle>
                  {bills.length > 0 && (
                    <CardDescription>Total: ₹{totalAmount.toFixed(2)}</CardDescription>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button 
                    variant="ghost"
                    size="icon"
                    onClick={() => setIsMaximized(!isMaximized)}
                    className="h-8 w-8"
                  >
                    {isMaximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                  </Button>
                  {bills.length > 0 && (
                    <Button 
                      onClick={handleExport}
                      size="sm"
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Export to Excel
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className={`overflow-auto ${isMaximized ? 'h-[calc(100%-80px)]' : 'h-[calc(100%-80px)]'}`}>
              {bills.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                  <Receipt className="h-20 w-20 mb-4 opacity-20" />
                  <p className="text-sm text-center">No bills extracted yet</p>
                  <p className="text-xs text-center mt-1">Process files to see extracted data here</p>
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[100px]">Date</TableHead>
                        <TableHead>Vendor</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead className="w-[100px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...bills].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).map((bill) => (
                        <TableRow key={bill.id}>
                          <TableCell>
                            {editingBill === bill.id ? (
                              <Input
                                type="date"
                                value={editValues.date || ''}
                                onChange={(e) => setEditValues({ ...editValues, date: e.target.value })}
                                className="h-8"
                              />
                            ) : (
                              <span className="text-sm">{bill.date}</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {editingBill === bill.id ? (
                              <Input
                                value={editValues.vendor || ''}
                                onChange={(e) => setEditValues({ ...editValues, vendor: e.target.value })}
                                className="h-8"
                              />
                            ) : (
                              <span className="font-medium">{bill.vendor}</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {editingBill === bill.id ? (
                              <Input
                                value={editValues.category || ''}
                                onChange={(e) => setEditValues({ ...editValues, category: e.target.value })}
                                className="h-8"
                              />
                            ) : (
                              <span className="capitalize">{bill.category.replace('_', ' ')}</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {editingBill === bill.id ? (
                              <Input
                                value={editValues.description || ''}
                                onChange={(e) => setEditValues({ ...editValues, description: e.target.value })}
                                className="h-8"
                              />
                            ) : (
                              <span className="text-sm text-muted-foreground">{bill.description}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {editingBill === bill.id ? (
                              <div className="flex gap-1">
                                <Input
                                  value={editValues.currency || ''}
                                  onChange={(e) => setEditValues({ ...editValues, currency: e.target.value })}
                                  className="h-8 w-16"
                                  placeholder="INR"
                                />
                                <Input
                                  type="number"
                                  value={editValues.amount || ''}
                                  onChange={(e) => setEditValues({ ...editValues, amount: Number(e.target.value) })}
                                  className="h-8 w-24"
                                />
                              </div>
                            ) : (
                              <span className="font-medium">{bill.currency} {bill.amount}</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              {editingBill === bill.id ? (
                                <>
                                  <Button 
                                    variant="ghost" 
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={handleSaveEdit}
                                  >
                                    <Save className="h-4 w-4 text-green-600" />
                                  </Button>
                                  <Button 
                                    variant="ghost" 
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={handleCancelEdit}
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                </>
                              ) : (
                                <>
                                  <Button 
                                    variant="ghost" 
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => handleStartEdit(bill)}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button 
                                    variant="ghost" 
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => handleDelete(bill.id)}
                                  >
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {error && (
            <Card className="border-destructive">
              <CardContent className="pt-6">
                <p className="text-sm text-destructive">{error}</p>
              </CardContent>
            </Card>
          )}

          {failedFiles.length > 0 && (
            <Card className="border-yellow-500">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg text-yellow-600 flex items-center gap-2">
                  <FileQuestion className="h-5 w-5" />
                  Failed Files ({failedFiles.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-40 overflow-auto">
                  {failedFiles.map((file, idx) => (
                    <div key={idx} className="text-sm p-2 bg-yellow-50 dark:bg-yellow-950/20 rounded border border-yellow-200 dark:border-yellow-800">
                      <p className="font-medium text-yellow-800 dark:text-yellow-400 truncate">{file.link}</p>
                      <p className="text-yellow-600 dark:text-yellow-500 text-xs mt-1">{file.message}</p>
                    </div>
                  ))}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full mt-3"
                  onClick={() => {
                    const failedLinks = failedFiles.map(f => f.link);
                    setFailedFiles([]);
                    processFiles(failedLinks);
                  }}
                >
                  <Play className="h-4 w-4 mr-2" />
                  Retry Failed Files
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
