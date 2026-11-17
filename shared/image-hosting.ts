export const imagePurposes = ['screenshot', 'snapshot', 'cover', 'favicon', 'default'] as const
export type ImagePurpose = (typeof imagePurposes)[number]
export interface ImageHostingConfig {
  backend: 's3' | 'http'
  endpoint: string
  bucket: string
  region: string
  prefix: string
  pathStyle: boolean
  publicURL: string
  fileField: string
  urlPath: string
  authHeader: string
  purposes: ImagePurpose[]
}
export const imageHostingDefaults: ImageHostingConfig = {
  backend: 's3',
  endpoint: '',
  bucket: '',
  region: 'auto',
  prefix: 'markvault',
  pathStyle: true,
  publicURL: '',
  fileField: 'file',
  urlPath: 'data.url',
  authHeader: 'Authorization',
  purposes: [],
}
