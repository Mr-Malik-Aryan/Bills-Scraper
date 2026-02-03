import { BillProcessor } from '@/lib/bill-processor';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: Request) {
    const { driveLinks } = await request.json();

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            const processor = new BillProcessor();
            const processedIds = new Set<string>();

            try {
                for (let i = 0; i < driveLinks.length; i++) {
                    const link = driveLinks[i];
                    
                    // Extract file ID and check for duplicates
                    const fileId = processor.extractFileId(link);
                    if (fileId && processedIds.has(fileId)) {
                        console.log(`Skipping duplicate file: ${fileId}`);
                        continue;
                    }
                    if (fileId) {
                        processedIds.add(fileId);
                    }

                    try {
                        // Send progress update - starting
                        const progressEvent = {
                            type: 'progress',
                            current: i + 1,
                            total: driveLinks.length,
                            message: `Processing bill ${i + 1}/${driveLinks.length}...`,
                            step: 'starting',
                            fileId,
                        };
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(progressEvent)}\n\n`));

                        // Send download progress
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                            type: 'progress',
                            current: i + 1,
                            total: driveLinks.length,
                            message: `Downloading bill ${i + 1}/${driveLinks.length}...`,
                            step: 'downloading',
                            fileId,
                        })}\n\n`));

                        // Extract data (this includes download + AI analysis)
                        const billData = await processor.extractBillData(link);

                        // Send analysis complete
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                            type: 'progress',
                            current: i + 1,
                            total: driveLinks.length,
                            message: `Analyzed bill ${i + 1}/${driveLinks.length}`,
                            step: 'completed',
                            fileId,
                        })}\n\n`));

                        // Send bill data
                        const billEvent = {
                            type: 'bill',
                            data: billData,
                        };
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(billEvent)}\n\n`));

                        // Small delay to be nice to APIs
                        await new Promise((resolve) => setTimeout(resolve, 1000));

                    } catch (error: unknown) {
                        console.error(`Error processing link ${link}:`, error);
                        const errorEvent = {
                            type: 'error',
                            link,
                            message: error instanceof Error ? error.message : 'Unknown processing error',
                        };
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`));
                    }
                }

                // Send complete event
                const completeEvent = { type: 'complete' };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(completeEvent)}\n\n`));

            } catch (error: unknown) {
                console.error('Stream error:', error);
                const fatalError = {
                    type: 'error',
                    link: 'system',
                    message: error instanceof Error ? error.message : 'Fatal processing error',
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(fatalError)}\n\n`));
            } finally {
                controller.close();
            }
        },
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });
}
