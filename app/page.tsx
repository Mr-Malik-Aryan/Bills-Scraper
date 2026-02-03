'use client';

import { useState, useRef } from 'react';
import { BillData } from '@/lib/bill-processor';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { ThemeToggle } from '@/components/theme-toggle';
import { FolderOpen, Play, Square, Download, FileText, X } from 'lucide-react';

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

  const handleEdit = (id: string, field: keyof BillData, value: string | number) => {
    setBills((prev) =>
      prev.map((bill) =>
        bill.id === id ? { ...bill, [field]: value } : bill
      )
    );
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
    <div className="min-h-screen bg-linear-to-br from-gray-50 to-blue-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto space-y-8">

        {/* Header */}
        <div className="text-center space-y-4">
          <h1 className="text-5xl font-bold text-gray-900 tracking-tight">
            Bill Reimbursement Scraper
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Automated bill extraction powered by Gemini AI
          </p>
        </div>

        {/* Input Card */}
        <div className="bg-white rounded-xl shadow-lg p-8 border border-gray-100">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Google Drive Folder Link
          </label>
          <div className="flex gap-4 mb-4">
            <input
              type="text"
              value={folderLink}
              onChange={(e) => setFolderLink(e.target.value)}
              placeholder="https://drive.google.com/drive/folders/..."
              className="flex-1 px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all"
            />
          </div>

          {/* Date Range Filters */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                From Uploaded at Date (Optional)
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                To Date (Optional)
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all"
              />
            </div>
          </div>

          <button
            onClick={handleScanFolder}
            disabled={loading || scanning || !folderLink}
            className="w-full px-8 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors shadow-lg shadow-blue-600/20"
          >
            {scanning ? 'Scanning Folder...' : 'Scan Folder'}
          </button>

          {/* Progress Bar */}
          {loading && (
            <div className="mt-6 space-y-2">
              <div className="flex justify-between items-center text-sm font-medium text-gray-600">
                <span>{progress.message}</span>
                <div className="flex items-center gap-3">
                  <span>{progress.current} / {progress.total}</span>
                  <button
                    onClick={() => {
                      setShouldStop(true);
                      stopRef.current = true;
                    }}
                    disabled={shouldStop}
                    className="px-3 py-1 bg-red-500 text-white text-xs font-semibold rounded hover:bg-red-600 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                  >
                    {shouldStop ? 'Stopping...' : 'Stop'}
                  </button>
                </div>
              </div>
              {progress.step && (
                <div className="text-xs text-gray-500">
                  Step: {progress.step === 'downloading' ? '⬇️ Downloading' : progress.step === 'completed' ? '✅ Completed' : '🔄 Starting'}
                </div>
              )}
              <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                <div
                  className="bg-blue-600 h-3 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* File Preview */}
        {scannedFiles.length > 0 && !loading && (
          <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-100">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-900">
                Found {scannedFiles.length} file{scannedFiles.length !== 1 ? 's' : ''} ({selectedFileIds.size} selected)
              </h3>
              <button
                onClick={() => {
                  if (selectedFileIds.size === scannedFiles.length) {
                    setSelectedFileIds(new Set());
                  } else {
                    setSelectedFileIds(new Set(scannedFiles.map(f => f.id)));
                  }
                }}
                className="text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                {selectedFileIds.size === scannedFiles.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>
            <div className="max-h-60 overflow-y-auto mb-4 space-y-2">
              {scannedFiles.map((file) => (
                <div key={file.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                  <input
                    type="checkbox"
                    checked={selectedFileIds.has(file.id)}
                    onChange={(e) => {
                      const newSelected = new Set(selectedFileIds);
                      if (e.target.checked) {
                        newSelected.add(file.id);
                      } else {
                        newSelected.delete(file.id);
                      }
                      setSelectedFileIds(newSelected);
                    }}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <div className="flex-1 flex items-center justify-between">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">{file.name}</p>
                      {file.createdTime && (
                        <p className="text-xs text-gray-500">
                          Created: {new Date(file.createdTime).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                    <span className="text-xs text-gray-500 uppercase">{file.mimeType.split('/')[1]}</span>
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={handleProcessFiles}
              disabled={loading || selectedFileIds.size === 0}
              className="w-full px-8 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors shadow-lg shadow-green-600/20"
            >
              Process {selectedFileIds.size} File{selectedFileIds.size !== 1 ? 's' : ''}
            </button>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r-lg">
            <div className="flex">
              <div className="shrink-0">
                <svg className="h-5 w-5 text-red-500" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Success Summary */}
        {bills.length > 0 && !loading && (
          <>
            <div className="bg-green-50 border-l-4 border-green-500 p-6 rounded-r-lg shadow-sm">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="text-lg font-medium text-green-800">Processing Complete!</h3>
                  <p className="text-sm text-green-700 mt-1">
                    Successfully extracted data from {bills.length} bills. Total Value: ₹{totalAmount.toFixed(2)}
                  </p>
                </div>
              </div>

              {/* Excel Column Toggles */}
              <div className="bg-white rounded-lg p-4 mb-4 border border-green-200">
                <h4 className="text-sm font-semibold text-gray-700 mb-3">Excel Export Settings:</h4>
                
                {/* Filename Input */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    File Name
                  </label>
                  <input
                    type="text"
                    value={excelFileName}
                    onChange={(e) => setExcelFileName(e.target.value)}
                    placeholder="bills"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-green-500 focus:ring-2 focus:ring-green-500/20 outline-none transition-all text-sm"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Will be saved as: {excelFileName.trim() || 'bills'}-{new Date().toISOString().split('T')[0]}.xlsx
                  </p>
                </div>

                {/* Column Toggles */}
                <h5 className="text-sm font-medium text-gray-700 mb-2">Columns to Include:</h5>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {Object.entries(excelColumns).map(([key, value]) => (
                    <label key={key} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={value}
                        onChange={(e) => setExcelColumns(prev => ({ ...prev, [key]: e.target.checked }))}
                        className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
                      />
                      <span className="text-sm text-gray-700 capitalize">{key.replace('_', ' ')}</span>
                    </label>
                  ))}
                </div>
              </div>

              <button
                onClick={handleExport}
                className="w-full px-6 py-2.5 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 transition-colors shadow-lg shadow-green-600/20 flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Export to Excel
              </button>
            </div>
          </>
        )}

        {/* Data Table */}
        {bills.length > 0 && (
          <Card className="bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Date</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Category</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Vendor</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Description</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Amount</th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {[...bills].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).map((bill) => (
                    <tr key={bill.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <input
                          type="date"
                          value={bill.date}
                          onChange={(e) => handleEdit(bill.id, 'date', e.target.value)}
                          className="w-full bg-transparent border-none focus:ring-0 p-0 text-sm text-gray-900"
                        />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <select
                          value={bill.category}
                          onChange={(e) => handleEdit(bill.id, 'category', e.target.value)}
                          className="w-full bg-transparent border-none focus:ring-0 p-0 text-sm text-gray-900"
                        >
                          <option value="food">Food</option>
                          <option value="travel">Travel</option>
                          <option value="office_supplies">Office Supplies</option>
                          <option value="software">Software</option>
                          <option value="entertainment">Entertainment</option>
                          <option value="other">Other</option>
                        </select>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <input
                          type="text"
                          value={bill.vendor}
                          onChange={(e) => handleEdit(bill.id, 'vendor', e.target.value)}
                          className="w-full bg-transparent border-none focus:ring-0 p-0 text-sm text-gray-900"
                        />
                      </td>
                      <td className="px-6 py-4">
                        <input
                          type="text"
                          value={bill.description}
                          onChange={(e) => handleEdit(bill.id, 'description', e.target.value)}
                          className="w-full bg-transparent border-none focus:ring-0 p-0 text-sm text-gray-900"
                        />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500 text-sm">{bill.currency}</span>
                          <input
                            type="number"
                            value={bill.amount}
                            onChange={(e) => handleEdit(bill.id, 'amount', parseFloat(e.target.value))}
                            className="w-24 bg-transparent border-none focus:ring-0 p-0 text-sm text-gray-900 font-medium"
                          />
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button
                          onClick={() => handleDelete(bill.id)}
                          className="text-red-600 hover:text-red-900 transition-colors"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                  {/* Total Row */}
                  <tr className="bg-gray-50 font-bold">
                    <td colSpan={4} className="px-6 py-4 text-right text-gray-900">Total:</td>
                    <td className="px-6 py-4 text-gray-900">₹{totalAmount.toFixed(2)}</td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
