# Vercel Tier Configuration

## Current Setup: **Hobby Tier** ✓

Your app is configured for Vercel Hobby tier limits.

## Comparison

| Feature | Hobby (Current) | Pro ($20/mo) |
|---------|----------------|--------------|
| **Function Timeout** | 10s | 60s |
| **Memory** | 1 GB | 3 GB |
| **Files per Request** | 1 file | 5-10 files |
| **Processing Speed** | ~10s per file | ~6s per file |
| **Concurrent Builds** | 1 | 12 |

## Performance on Hobby Tier

- ✅ Processes **1 file every 10 seconds**
- ✅ Auto-chunks large batches
- ✅ No timeout errors
- ⚠️ **10 files = ~100 seconds** (sequential)

## To Upgrade to Pro

1. **Update vercel.json**:
   ```bash
   # Rename files
   mv vercel.json vercel.hobby.json
   mv vercel.pro.json vercel.json
   ```

2. **Update route.ts** - Change these lines:
   ```typescript
   // Line 4-5
   export const maxDuration = 60; // Change from 10 to 60
   
   // Line 82
   const CHUNK_SIZE = 5; // Change from 1 to 5
   
   // Line 93
   3, // Change from 1 to 3 (parallel processing)
   
   // Line 100
   8000  // Change to 45000 (45s timeout)
   ```

3. **Upgrade on Vercel Dashboard**:
   - Go to https://vercel.com/dashboard
   - Settings → Billing → Upgrade to Pro

## Pro Benefits for This App

- **5-10x faster**: Process multiple files in parallel
- **Better reliability**: More time for AI analysis
- **Handle larger files**: 3GB memory vs 1GB

## Staying on Hobby

The current setup works perfectly for Hobby tier:
- No changes needed
- Processes files reliably
- Just slower for large batches
