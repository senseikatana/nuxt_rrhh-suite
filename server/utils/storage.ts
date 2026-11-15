import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

/**
 * Almacenamiento de objetos compatible con S3 (Neon Storage).
 *
 * El endpoint y las credenciales salen del entorno. Los valores los da el
 * dashboard de Neon en Connect → Storage → pestaña `.env`:
 *   AWS_ENDPOINT_URL_S3 (o AWS_ENDPOINT_URL), AWS_REGION,
 *   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
 * El bucket por defecto es `assets`; se puede cambiar con S3_BUCKET.
 *
 * El SDK usa `fetch`, así que funciona igual en Node y en Cloudflare Workers.
 * Nunca commitear estas credenciales: van en `.env` (local) o en los secrets
 * del proyecto de Cloudflare.
 */
let client: S3Client | null = null

function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      forcePathStyle: true,
      region: process.env.AWS_REGION ?? 'auto',
      endpoint: process.env.AWS_ENDPOINT_URL_S3 ?? process.env.AWS_ENDPOINT_URL,
    })
  }
  return client
}

/** Bucket activo (por defecto `assets`). */
export function storageBucket(): string {
  return process.env.S3_BUCKET ?? process.env.AWS_BUCKET ?? 'assets'
}

/** Sube un objeto (Uint8Array/Buffer/string) al bucket. */
export async function putObject(
  key: string,
  body: Uint8Array | string,
  contentType?: string,
): Promise<void> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: storageBucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  )
}

/** URL firmada de descarga temporal (por defecto 1 h). */
export async function getDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
  return getSignedUrl(getClient(), new GetObjectCommand({ Bucket: storageBucket(), Key: key }), {
    expiresIn,
  })
}

/** Borra un objeto del bucket. */
export async function deleteObject(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: storageBucket(), Key: key }))
}
