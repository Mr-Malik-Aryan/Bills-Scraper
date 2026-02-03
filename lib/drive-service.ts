import { google } from 'googleapis';

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

    async listFilesInFolder(folderId: string): Promise<string[]> {
        try {
            const response = await this.drive.files.list({
                q: `'${folderId}' in parents and (mimeType='image/jpeg' or mimeType='image/png' or mimeType='image/webp' or mimeType='application/pdf') and trashed=false`,
                fields: 'files(id, name, mimeType)',
                pageSize: 100,
                key: this.apiKey, // Explicitly pass API key here
            });

            const files = response.data.files || [];
            return files.map((file) => `https://drive.google.com/file/d/${file.id}/view`);
        } catch (error: unknown) {
            if (typeof error === 'object' && error !== null && 'code' in error && (error as any).code === 404 || (error instanceof Error && error.message.includes('File not found'))) {
                throw new Error("Folder not found. Make sure it's shared with 'Anyone with the link'");
            }
            throw new Error(`Failed to access folder: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}
