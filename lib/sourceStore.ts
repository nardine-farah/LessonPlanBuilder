import { promises as fs } from "fs";
import path from "path";
import { storageBucket } from "./firestore-server";

/**
 * Durable home for source PDFs: `source-pdfs/{sourceId}.pdf` in the Storage
 * bucket, content-hash named (sourceId = hash(bytes+language)), so the same
 * booklet is stored once no matter how many plans or reviewers use it.
 *
 * The local .analysis-cache stays the fast path — but it lives on ephemeral
 * instance disk (wiped by every rollout, pruned after 14 days). Every PDF
 * that enters the cache is also persisted here, and cache misses restore
 * from here, so a plan's source document stays attached to it permanently —
 * no more "re-attach the PDF" after a redeploy.
 */

const CACHE_DIR = path.join(process.cwd(), ".analysis-cache");
const SOURCE_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;

const objectPath = (sourceId: string) => `source-pdfs/${sourceId}.pdf`;
const localPath = (sourceId: string) => path.join(CACHE_DIR, `${sourceId}.pdf`);

/**
 * Persist a source PDF to Storage, fire-and-forget: analysis never waits on
 * (or fails because of) the durable copy. Content-addressed, so overwrites
 * are idempotent.
 */
export function persistSourcePdf(sourceId: string, bytes: Uint8Array): void {
  if (!SOURCE_ID_PATTERN.test(sourceId)) return;
  void storageBucket()
    .then((bucket) =>
      bucket.file(objectPath(sourceId)).save(Buffer.from(bytes), {
        contentType: "application/pdf",
        resumable: false,
      }),
    )
    .catch((e) => {
      console.warn(`[source-pdfs] persist failed for ${sourceId}: ${e instanceof Error ? e.message : e}`);
    });
}

/**
 * Restore a source PDF from Storage into the local cache. Returns true when
 * the local file is in place afterwards; false when the durable copy doesn't
 * exist (plans whose PDFs predate persistence) or Storage is unreachable.
 */
export async function restoreSourcePdf(sourceId: string): Promise<boolean> {
  if (!SOURCE_ID_PATTERN.test(sourceId)) return false;
  try {
    const [bytes] = await (await storageBucket()).file(objectPath(sourceId)).download();
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(localPath(sourceId), bytes);
    return true;
  } catch {
    return false;
  }
}
