import { GoogleGenAI } from '@google/genai';
import axios from 'axios';
// PDF text extraction removed: we now upload the file directly to AI

export interface BillData {
  id: string;
  category: string;
  amount: number;
  currency: string;
  date: string;
  vendor: string;
  description: string;
  driveLink: string;
}

export class BillProcessor {
  private genAI: GoogleGenAI;
  private modelName: string;
  private maxRetries: number = 3;
  private baseDelay: number = 1000; // 1 second

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set in environment variables');
    }
    this.genAI = new GoogleGenAI({
      apiKey: apiKey,
    });
    this.modelName = 'gemini-3-flash-preview';
  }

  extractFileId(driveLink: string): string | null {
    const match = driveLink.match(/\/d\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  }

  async downloadFromDrive(fileId: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const url = `https://drive.google.com/uc?export=download&id=${fileId}`;
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      
      let mimeType = response.headers['content-type'] || '';
      
      // If we get application/octet-stream or no mime type, try to detect from file signature
      if (!mimeType || mimeType === 'application/octet-stream' || mimeType.includes('octet-stream')) {
        const buffer = Buffer.from(response.data);
        mimeType = this.detectMimeType(buffer);
      }
      
      return { buffer: Buffer.from(response.data), mimeType };
    } catch (error) {
      console.error('Error downloading file:', error);
      throw new Error(`Failed to download file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private detectMimeType(buffer: Buffer): string {
    // Check file signatures (magic numbers)
    if (buffer.length < 4) return 'image/jpeg'; // Default fallback
    
    // JPEG
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
      return 'image/jpeg';
    }
    // PNG
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      return 'image/png';
    }
    // PDF
    if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
      
      return 'application/pdf';
    }
    // WebP
    if (buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
      return 'image/webp';
    }
    // GIF
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
      return 'image/gif';
    }
    
    // Default to JPEG if we can't detect
    return 'image/jpeg';
  }

  private validateAndRepairJson(jsonStr: string): { valid: boolean; repaired?: string; error?: string; position?: number } {
    try {
      JSON.parse(jsonStr);
      return { valid: true, repaired: jsonStr };
    } catch (e: any) {
      const errorMsg = e.message || '';
      const posMatch = errorMsg.match(/position (\d+)/);
      const position = posMatch ? parseInt(posMatch[1]) : -1;
      
      console.log(`JSON parse error: ${errorMsg}`);
      if (position >= 0) {
        const start = Math.max(0, position - 20);
        const end = Math.min(jsonStr.length, position + 20);
        console.log(`Context around position ${position}: "${jsonStr.substring(start, end)}"`);
      }
      
      // Attempt repairs
      let fixed = jsonStr;
      
      // 1. Fix unterminated strings by finding unclosed quotes
      const quoteCount = (fixed.match(/"/g) || []).length;
      if (quoteCount % 2 !== 0) {
        // Find the position of unterminated string
        let inString = false;
        let lastQuotePos = -1;
        for (let i = 0; i < fixed.length; i++) {
          if (fixed[i] === '"' && (i === 0 || fixed[i-1] !== '\\')) {
            inString = !inString;
            lastQuotePos = i;
          }
        }
        
        // If we're still in a string at the end, close it before the last brace
        if (inString) {
          const lastBrace = fixed.lastIndexOf('}');
          if (lastBrace > lastQuotePos) {
            fixed = fixed.substring(0, lastBrace) + '"' + fixed.substring(lastBrace);
            console.log('Fixed unterminated string');
          }
        }
      }
      
      // 2. Escape unescaped quotes within string values
      const lines = fixed.split('\n');
      const repairedLines = lines.map(line => {
        // Match pattern: "key": "value with " problem"
        return line.replace(/:\s*"([^"]*?)"([^"]*?)"([^,}]*)/g, (match, start, middle, end) => {
          if (middle.includes(':') || middle.includes('{') || middle.includes('}')) {
            return match; // This isn't a broken string
          }
          return `: "${start}\\"${middle}"${end}`;
        });
      });
      fixed = repairedLines.join('\n');
      
      // 3. Try parsing again
      try {
        JSON.parse(fixed);
        console.log('Successfully repaired JSON');
        return { valid: true, repaired: fixed };
      } catch (e2: any) {
        return { 
          valid: false, 
          error: e2.message, 
          position: position >= 0 ? position : undefined 
        };
      }
    }
  }

  // Removed: direct PDF text extraction. We send the file to the model.

  private isRetryableError(error: any): boolean {
    if (!error) return false;
    const errorStr = JSON.stringify(error);
    const code = error?.error?.code || error?.code || error?.status;
    // Retry on 503 (service unavailable), 429 (rate limit), 500 (server error)
    return code === 503 || code === 429 || code === 500 || 
           errorStr.includes('overloaded') || 
           errorStr.includes('UNAVAILABLE') ||
           errorStr.includes('RESOURCE_EXHAUSTED');
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async extractBillData(driveLink: string): Promise<BillData> {
    const fileId = this.extractFileId(driveLink);
    if (!fileId) {
      throw new Error(`Invalid Google Drive link: ${driveLink}`);
    }

    const { buffer, mimeType } = await this.downloadFromDrive(fileId);

    const prompt = `Analyze the uploaded receipt/bill file (image or PDF) and extract the following information. Return ONLY a valid JSON object with no additional text, markdown, or formatting.

Required JSON format:
{
  "category": "food|travel|office_supplies|software|entertainment|other",
  "amount": 0.00,
  "currency": "INR",
  "date": "YYYY-MM-DD",
  "vendor": "vendor name",
  "description": "brief description"
}

Important:
- Return ONLY the JSON object
- Ensure all strings are properly escaped
- Use double quotes for all keys and string values
- Amount must be a number
- Category must be one of: food, travel, office_supplies, software, entertainment, or other

Please analyze the file provided. If the content is a PDF with multiple pages, consider the overall document. If it's an image, use visual OCR to extract text.`;

    const contentParts: any[] = [{ text: prompt }];
    const base64Data = buffer.toString('base64');
    
    // Immediately clear buffer to free memory
    buffer.fill(0);
    
    contentParts.push({
      inlineData: {
        data: base64Data,
        mimeType: mimeType,
      },
    });

    // Retry logic with exponential backoff
    let lastError: any = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.genAI.models.generateContent({
        model: this.modelName,
        contents: [
          {
            role: 'user',
            parts: contentParts,
          },
        ],
        config: {
          temperature: 0.1,
          topP: 0.95,
          topK: 40,
          maxOutputTokens: 1024,
          responseMimeType: 'application/json',
        },
      });

      let text = '';
      const respAny: any = response as any;
      if (typeof respAny.text === 'function') {
        try {
          text = (respAny.text() || '').trim();
        } catch {
          text = '';
        }
      } else {
        const raw = respAny.text ?? '';
        text = (typeof raw === 'string' ? raw : String(raw)).trim();
      }
      console.log('Raw Gemini response:', text);

      // Clean up markdown code blocks if present
      text = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
      text = text.replace(/^```\s*/i, '').replace(/\s*```$/i, '');
      
      // Try to extract JSON from the response if it's wrapped in other text
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        text = jsonMatch[0];
      }
      
      // Clean up common JSON issues
      text = text.replace(/[\u0000-\u001F\u007F-\u009F]/g, ''); // Remove control characters
      text = text.replace(/,\s*([\]}])/g, '$1'); // Remove trailing commas
      
      console.log('Cleaned JSON text:', text);
      
      // Validate and repair JSON
      const validation = this.validateAndRepairJson(text);
      if (!validation.valid) {
        const errorDetail = validation.position !== undefined 
          ? `at position ${validation.position}: "${text.substring(Math.max(0, validation.position - 20), Math.min(text.length, validation.position + 20))}"`
          : '';
        throw new Error(`Invalid JSON from Gemini ${errorDetail}. Error: ${validation.error}. Raw: ${text.substring(0, 200)}`);
      }
      
      const data = JSON.parse(validation.repaired!);

        return {
          id: fileId,
          category: data.category || 'other',
          amount: typeof data.amount === 'number' ? data.amount : parseFloat(data.amount) || 0,
          currency: data.currency || 'USD',
          date: data.date || new Date().toISOString().split('T')[0],
          vendor: data.vendor || 'Unknown',
          description: data.description || 'No description',
          driveLink: driveLink,
        };
      } catch (error: any) {
        lastError = error;
        
        // Check if this is a retryable error and we have retries left
        if (this.isRetryableError(error) && attempt < this.maxRetries) {
          const delay = this.baseDelay * Math.pow(2, attempt); // Exponential backoff
          console.log(`Retryable error (attempt ${attempt + 1}/${this.maxRetries}). Retrying in ${delay}ms...`);
          await this.sleep(delay);
          continue; // Retry
        }
        
        // Non-retryable error or out of retries - throw
        console.error('Error extracting bill data:', error);
        throw new Error(`Failed to process bill with Gemini: ${error instanceof Error ? error.message : JSON.stringify(error)}`);
      }
    }
 
    // If we exhausted all retries
    throw new Error(`Failed after ${this.maxRetries} retries: ${lastError instanceof Error ? lastError.message : JSON.stringify(lastError)}`);
  }
}
