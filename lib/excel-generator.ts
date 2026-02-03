import ExcelJS from 'exceljs';
import { BillData } from './bill-processor';

export interface ExcelColumns {
    date?: boolean;
    category?: boolean;
    vendor?: boolean;
    description?: boolean;
    amount?: boolean;
    currency?: boolean;
    receipt?: boolean;
}

export async function generateExcel(bills: BillData[], columns?: ExcelColumns): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Reimbursements');

    // Default to all columns if not specified
    const cols = columns || {
        date: true,
        category: true,
        vendor: true,
        description: true,
        amount: true,
        currency: true,
        receipt: true,
    };

    // Build columns dynamically based on configuration
    const worksheetColumns: any[] = [];
    let amountColIndex = 0;
    let currentColIndex = 0;

    if (cols.date) {
        worksheetColumns.push({ header: 'Date', key: 'date', width: 12 });
        currentColIndex++;
    }
    if (cols.category) {
        worksheetColumns.push({ header: 'Category', key: 'category', width: 20 });
        currentColIndex++;
    }
    if (cols.vendor) {
        worksheetColumns.push({ header: 'Vendor', key: 'vendor', width: 25 });
        currentColIndex++;
    }
    if (cols.description) {
        worksheetColumns.push({ header: 'Description', key: 'description', width: 35 });
        currentColIndex++;
    }
    if (cols.amount) {
        amountColIndex = currentColIndex + 1; // Excel is 1-indexed
        worksheetColumns.push({ header: 'Amount', key: 'amount', width: 12 });
        currentColIndex++;
    }
    if (cols.currency) {
        worksheetColumns.push({ header: 'Currency', key: 'currency', width: 10 });
        currentColIndex++;
    }
    if (cols.receipt) {
        worksheetColumns.push({ header: 'Receipt', key: 'link', width: 50 });
        currentColIndex++;
    }

    worksheet.columns = worksheetColumns;

    // Style header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' },
    };

    // Group bills by category
    const categories = ['food', 'travel', 'office_supplies', 'software', 'entertainment', 'other'];
    const groupedBills: Record<string, BillData[]> = {};
    categories.forEach(cat => groupedBills[cat] = []);
    
    bills.forEach((bill) => {
        const cat = bill.category.toLowerCase();
        if (groupedBills[cat]) {
            groupedBills[cat].push(bill);
        } else {
            groupedBills['other'].push(bill);
        }
    });

    // Sort bills by date within each category (oldest to newest)
    categories.forEach(cat => {
        groupedBills[cat].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    });

    let currentRow = 2;
    const categoryColors: Record<string, string> = {
        food: 'FFFCE4D6',
        travel: 'FFD9E1F2',
        office_supplies: 'FFE2EFDA',
        software: 'FFF4E2D6',
        entertainment: 'FFFEF2CB',
        other: 'FFE6E6E6',
    };

    const subtotalRows: number[] = []; // Track subtotal row numbers

    // Add each category section
    categories.forEach((category) => {
        const categoryBills = groupedBills[category];
        if (categoryBills.length === 0) return;

        // Category header
        const catHeaderRow = worksheet.getRow(currentRow);
        const totalCols = worksheetColumns.length;
        worksheet.mergeCells(currentRow, 1, currentRow, totalCols);
        const catCell = worksheet.getCell(currentRow, 1);
        catCell.value = category.toUpperCase().replace('_', ' ');
        catCell.font = { bold: true, size: 11 };
        catCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: categoryColors[category] || 'FFE6E6E6' },
        };
        catCell.alignment = { horizontal: 'left' };
        currentRow++;

        // Add bills in this category
        const startRow = currentRow;
        categoryBills.forEach((bill) => {
            const row: any = {};
            if (cols.date) row.date = bill.date;
            if (cols.category) row.category = bill.category.toUpperCase();
            if (cols.vendor) row.vendor = bill.vendor;
            if (cols.description) row.description = bill.description;
            if (cols.amount) row.amount = bill.amount;
            if (cols.currency) row.currency = bill.currency;
            if (cols.receipt) row.link = 'Open Link'; // Placeholder text
            const addedRow = worksheet.addRow(row);
            
            // Add hyperlink to receipt cell if receipt column is enabled
            if (cols.receipt && bill.driveLink) {
                const receiptColIndex = currentColIndex; // Last column is receipt
                const cell = worksheet.getCell(currentRow, receiptColIndex);
                cell.value = {
                    text: 'Open Link',
                    hyperlink: bill.driveLink,
                };
                cell.font = { color: { argb: 'FF0563C1' }, underline: true };
                cell.alignment = { horizontal: 'left' };
            }
            currentRow++;
        });

        // Subtotal row for category (only if amount column is enabled)
        if (cols.amount) {
            const subtotalRow = worksheet.getRow(currentRow);
            const descColIndex = cols.description ? (cols.date ? 1 : 0) + (cols.category ? 1 : 0) + (cols.vendor ? 1 : 0) + 1 : amountColIndex - 1;
            worksheet.getCell(currentRow, descColIndex).value = `${category.toUpperCase()} SUBTOTAL`;
            worksheet.getCell(currentRow, descColIndex).font = { bold: true, italic: true };
            const amountCol = String.fromCharCode(64 + amountColIndex); // Convert to Excel column letter
            worksheet.getCell(currentRow, amountColIndex).value = {
                formula: `SUM(${amountCol}${startRow}:${amountCol}${currentRow - 1})`,
                result: 0,
            };
            worksheet.getCell(currentRow, amountColIndex).font = { bold: true };
            subtotalRow.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFF2F2F2' },
            };
            subtotalRows.push(currentRow); // Track this subtotal row
        }
        currentRow++;
        currentRow++; // Empty row between categories
    });

    // Grand total row - sum only the subtotal cells (only if amount column is enabled)
    if (cols.amount && subtotalRows.length > 0) {
        const grandTotalRow = worksheet.getRow(currentRow);
        const descColIndex = cols.description ? (cols.date ? 1 : 0) + (cols.category ? 1 : 0) + (cols.vendor ? 1 : 0) + 1 : amountColIndex - 1;
        worksheet.getCell(currentRow, descColIndex).value = 'GRAND TOTAL';
        worksheet.getCell(currentRow, descColIndex).font = { bold: true, size: 12 };
        const amountCol = String.fromCharCode(64 + amountColIndex);
        const subtotalRefs = subtotalRows.map(row => `${amountCol}${row}`).join('+');
        worksheet.getCell(currentRow, amountColIndex).value = {
            formula: subtotalRefs || '0',
            result: 0,
        };
        worksheet.getCell(currentRow, amountColIndex).font = { bold: true, size: 12 };
        grandTotalRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4472C4' },
        };
        grandTotalRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer as unknown as Buffer;
}

function parseCsv(csv: string): Array<Record<string, string>> {
    const lines = csv.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim().length > 0);
    if (lines.length === 0) return [];
    const split = (line: string) => {
        const result: string[] = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
                    current += '"';
                    i++; // skip escaped quote
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (ch === ',' && !inQuotes) {
                result.push(current);
                current = '';
            } else {
                current += ch;
            }
        }
        result.push(current);
        return result.map(s => s.trim());
    };

    const headers = split(lines[0]).map(h => h.toLowerCase());
    const rows: Array<Record<string, string>> = [];
    for (let li = 1; li < lines.length; li++) {
        const values = split(lines[li]);
        const row: Record<string, string> = {};
        headers.forEach((h, idx) => {
            row[h] = values[idx] ?? '';
        });
        rows.push(row);
    }
    return rows;
}

export async function generateExcelFromCsv(csv: string): Promise<Buffer> {
    const rows = parseCsv(csv);
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Reimbursements');

    worksheet.columns = [
        { header: 'Date', key: 'date', width: 12 },
        { header: 'Category', key: 'category', width: 20 },
        { header: 'Vendor', key: 'vendor', width: 25 },
        { header: 'Description', key: 'description', width: 35 },
        { header: 'Amount', key: 'amount', width: 12 },
        { header: 'Currency', key: 'currency', width: 10 },
        { header: 'Receipt', key: 'link', width: 50 },
    ];

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' },
    };

    rows.forEach((r) => {
        const amountStr = r['amount'] ?? r['value'] ?? '';
        const amount = typeof amountStr === 'string' ? parseFloat(amountStr.replace(/[^0-9.-]/g, '')) : Number(amountStr) || 0;
        worksheet.addRow({
            date: r['date'] ?? '',
            category: (r['category'] ?? '').toUpperCase(),
            vendor: r['vendor'] ?? r['merchant'] ?? '',
            description: r['description'] ?? r['details'] ?? '',
            amount,
            currency: r['currency'] ?? 'USD',
            link: r['receipt'] ?? r['link'] ?? '',
        });
    });

    const totalRowNumber = rows.length + 2;
    const totalRow = worksheet.getRow(totalRowNumber);
    worksheet.getCell(`D${totalRowNumber}`).value = 'TOTAL';
    worksheet.getCell(`E${totalRowNumber}`).value = {
        formula: `SUM(E2:E${rows.length + 1})`,
        result: 0,
    };
    totalRow.font = { bold: true };

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer as unknown as Buffer;
}
