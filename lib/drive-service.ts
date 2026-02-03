import { google } from 'googleapis';

export interface FileMetadata {
    id: string;
    name: string;
    mimeType: string;
    createdTime?: string;
    modifiedTime?: string;
    link: string;
}

export class DriveService {
    private drive;
    private apiKey: string;

    constructor() {
        const apiKey = process.env.GOOGLE_DRIVE_API_KEY?.trim();
        if (!apiKey) {
            throw new Error('GOOGLE_DRIVE_API_KEY is not set in environment variables');
        }
        this.apiKey = apiKey;
        this.drive = google.drive({
            version: 'v3',
            auth: apiKey, // Keep this, but we'll also add it to the request
        });
    }

    extractFolderId(folderLink: string): string | null {
        const patterns = [
            /\/folders\/([a-zA-Z0-9_-]+)/,
            /id=([a-zA-Z0-9_-]+)/,
            /^([a-zA-Z0-9_-]+)$/,
        ];

        for (const pattern of patterns) {
            const match = folderLink.match(pattern);
            if (match) {
                return match[1];
            }
        }
        return null;
    }

    async listFilesInFolder(folderId: string, startDate?: string, endDate?: string): Promise<FileMetadata[]> {
        try {
            let query = `'${folderId}' in parents and (mimeType='image/jpeg' or mimeType='image/png' or mimeType='image/webp' or mimeType='application/pdf') and trashed=false`;
            
            if (startDate) {
                query += ` and createdTime >= '${startDate}'`;
            }
            if (endDate) {
                query += ` and createdTime <= '${endDate}'`;
            }

            const response = await this.drive.files.list({
                q: query,
                fields: 'files(id, name, mimeType, createdTime, modifiedTime)',
                pageSize: 1000,
                orderBy: 'createdTime',
                key: this.apiKey,
            });

            const files = response.data.files || [];
            return files.map((file) => ({
                id: file.id!,
                name: file.name || 'Untitled',
                mimeType: file.mimeType || 'application/octet-stream',
                createdTime: file.createdTime || undefined,
                modifiedTime: file.modifiedTime || undefined,
                link: `https://drive.google.com/file/d/${file.id}/view`,
            }));
        } catch (error: unknown) {
            if (typeof error === 'object' && error !== null && 'code' in error && (error as any).code === 404 || (error instanceof Error && error.message.includes('File not found'))) {
                throw new Error("Folder not found. Make sure it's shared with 'Anyone with the link'");
            }
            throw new Error(`Failed to access folder: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}
