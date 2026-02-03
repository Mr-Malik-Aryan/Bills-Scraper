import { BillProcessor } from '@/lib/bill-processor';

export const runtime = 'nodejs';
// Vercel limits: Hobby = 10s, Pro = 60s, Enterprise = 300s
// Currently configured for Hobby tier
export const maxDuration = 10;

// Process files in parallel with concurrency limit
async function processWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    processor: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    const results: R[] = [];
    const executing: Promise<void>[] = [];

    for (let i = 0; i < items.length; i++) {
        const promise = processor(items[i], i).then((result) => {
            results[i] = result;
        });

        executing.push(promise);

        if (executing.length >= concurrency) {
            await Promise.race(executing);
            executing.splice(
                executing.findIndex((p) => p === promise),
                1
            );
        }
    }

    await Promise.all(executing);
    return results;
}

export async function POST(request: Request) {
    const { driveLinks } = await request.json();

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            const processor = new BillProcessor();
            const processedIds = new Set<string>();
            let completedCount = 0;

            // Helper to send events and flush immediately
            const sendEvent = (event: any) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            };

            try {
                // Filter duplicates upfront
                const uniqueLinks = driveLinks.filter((link: string) => {
                    const fileId = processor.extractFileId(link);
                    if (!fileId || processedIds.has(fileId)) {
                        console.log(`Skipping duplicate file: ${fileId}`);
                        return false;
                    }
                    processedIds.add(fileId);
                    return true;
                });

                // Process 1 file at a time for Hobby tier (10s limit)
                // Upgrade to Pro for parallel processing (concurrency: 3)
                await processWithConcurrency(
                    uniqueLinks,
                    1, // Process 1 file at a time on Hobby tier
                    async (link: string, index: number) => {
                        const fileId = processor.extractFileId(link);
                        
                        try {
                            // Send starting event
                            sendEvent({
                                type: 'progress',
                                current: index + 1,
                                total: uniqueLinks.length,
                                message: `Processing bill ${index + 1}/${uniqueLinks.length}...`,
                                step: 'starting',
                                fileId,
                            });

                            // Extract data with timeout (8s to stay under 10s function limit)
                            const timeoutPromise = new Promise((_, reject) => 
                                setTimeout(() => reject(new Error('Processing timeout (8s)')), 8000)
                            );
                            
                            const billData = await Promise.race([
                                processor.extractBillData(link),
                                timeoutPromise
                            ]) as any;

                            completedCount++;

                            // Send success events
                            sendEvent({
                                type: 'progress',
                                current: completedCount,
                                total: uniqueLinks.length,
                                message: `Completed ${completedCount}/${uniqueLinks.length}`,
                                step: 'completed',
                                fileId,
                            });

                            sendEvent({
                                type: 'bill',
                                data: billData,
                            });

                            return billData;

                        } catch (error: unknown) {
                            console.error(`Error processing link ${link}:`, error);
                            sendEvent({
                                type: 'error',
                                link,
                                fileId,
                                message: error instanceof Error ? error.message : 'Unknown processing error',
                            });
                            return null;
                        }
                    }
                );

                // Send complete event
                sendEvent({ type: 'complete' });

            } catch (error: unknown) {
                console.error('Stream error:', error);
                sendEvent({
                    type: 'error',
                    link: 'system',
                    message: error instanceof Error ? error.message : 'Fatal processing error',
                });
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
