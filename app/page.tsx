'use client';

import { useState } from 'react';
import { BillData } from '@/lib/bill-processor';

export default function Home() {
  const [folderLink, setFolderLink] = useState('');
  const [bills, setBills] = useState<BillData[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState('');

  const handleScanFolder = async () => {
    setScanning(true);
    setError('');

    try {
      const response = await fetch('/api/scan-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderLink }),
      });

      const scanData = await response.json();

      if (!response.ok) {
        throw new Error(scanData.error || 'Failed to scan folder');
      }

      if (!scanData.fileLinks || scanData.fileLinks.length === 0) {
        setError('No supported files found in the folder.');
        setScanning(false);
        return;
      }

      setScanning(false);
      processFiles(scanData.fileLinks);

    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setScanning(false);
    }
  };

  const processFiles = async (fileLinks: string[]) => {
    setLoading(true);
    setBills([]);
    setProgress({ current: 0, total: fileLinks.length });

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
                setProgress({ current: event.current, total: event.total });
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
        body: JSON.stringify({ bills }),
      });

      if (!response.ok) throw new Error('Failed to export');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bills-${new Date().toISOString().split('T')[0]}.xlsx`;
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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 py-12 px-4 sm:px-6 lg:px-8">
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
          <div className="flex gap-4">
            <input
              type="text"
              value={folderLink}
              onChange={(e) => setFolderLink(e.target.value)}
              placeholder="https://drive.google.com/drive/folders/..."
              className="flex-1 px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all"
            />
            <button
              onClick={handleScanFolder}
              disabled={loading || scanning || !folderLink}
              className="px-8 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors shadow-lg shadow-blue-600/20"
            >
              {scanning ? 'Scanning...' : 'Start Auto-Scrape'}
            </button>
          </div>

          {/* Progress Bar */}
          {(scanning || loading) && (
            <div className="mt-6 space-y-2">
              <div className="flex justify-between text-sm font-medium text-gray-600">
                <span>{scanning ? 'Scanning folder...' : 'Processing bills...'}</span>
                <span>{progress.current} / {progress.total}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                <div
                  className="bg-blue-600 h-3 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r-lg">
            <div className="flex">
              <div className="flex-shrink-0">
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
          <div className="bg-green-50 border-l-4 border-green-500 p-6 rounded-r-lg flex justify-between items-center shadow-sm">
            <div>
              <h3 className="text-lg font-medium text-green-800">Processing Complete!</h3>
              <p className="text-sm text-green-700 mt-1">
                Successfully extracted data from {bills.length} bills. Total Value: ${totalAmount.toFixed(2)}
              </p>
            </div>
            <button
              onClick={handleExport}
              className="px-6 py-2.5 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 transition-colors shadow-lg shadow-green-600/20 flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export to Excel
            </button>
          </div>
        )}

        {/* Data Table */}
        {bills.length > 0 && (
          <div className="bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden">
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
                  {bills.map((bill) => (
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
                    <td className="px-6 py-4 text-gray-900">${totalAmount.toFixed(2)}</td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
