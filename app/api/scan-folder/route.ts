import { NextResponse } from 'next/server';
import { DriveService } from '@/lib/drive-service';

export async function POST(request: Request) {
    try {
        const { folderLink, startDate, endDate } = await request.json();

        if (!folderLink) {
            return NextResponse.json(
                { error: 'Folder link is required' },
                { status: 400 }
            );
        }

        const driveService = new DriveService();
        const folderId = driveService.extractFolderId(folderLink);

        if (!folderId) {
            return NextResponse.json(
                { error: 'Invalid Google Drive folder link' },
                { status: 400 }
            );
        }

        const files = await driveService.listFilesInFolder(folderId, startDate, endDate);

        return NextResponse.json({
            success: true,
            files,
            count: files.length,
        });
    } catch (error: unknown) {
        console.error('Scan folder error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to scan folder' },
            { status: 500 }
        );
    }
}
