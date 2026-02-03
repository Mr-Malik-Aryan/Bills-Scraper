import ExcelJS from 'exceljs';
import { BillData } from './bill-processor';

export async function generateExcel(bills: BillData[]): Promise<Buffer> {
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

    // Style header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' },
    };

    // Add Data
    bills.forEach((bill) => {
        worksheet.addRow({
            date: bill.date,
            category: bill.category.toUpperCase(),
            vendor: bill.vendor,
            description: bill.description,
            amount: bill.amount,
            currency: bill.currency,
            link: bill.driveLink,
        });
    });

    // Add Total Row
    const totalRowNumber = bills.length + 2;
    const totalRow = worksheet.getRow(totalRowNumber);

    // Set description cell
    worksheet.getCell(`D${totalRowNumber}`).value = 'TOTAL';

    // Set amount cell with formula
    worksheet.getCell(`E${totalRowNumber}`).value = {
        formula: `SUM(E2:E${bills.length + 1})`,
        result: 0 // Optional initial value
    };

    // Bold the total row
    totalRow.font = { bold: true };

    // Write to buffer casting to any because writeBuffer returns valid buffer but typescript definition might be slightly off in some versions
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
