import { generateExcel, generateExcelFromCsv } from '@/lib/excel-generator';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { csv, bills } = body;

        let buffer: Buffer;
        if (typeof csv === 'string' && csv.trim().length > 0) {
            buffer = await generateExcelFromCsv(csv);
        } else if (Array.isArray(bills) && bills.length > 0) {
            buffer = await generateExcel(bills);
        } else {
            return new Response('No CSV or bills to export', { status: 400 });
        }

        const filename = `bills-${new Date().toISOString().split('T')[0]}.xlsx`;

        return new Response(buffer as unknown as BodyInit, {
            headers: {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename="${filename}"`,
            },
        });
    } catch (error: unknown) {
        console.error('Export error:', error);
        return new Response(error instanceof Error ? error.message : 'Failed to generate Excel', { status: 500 });
    }
}
