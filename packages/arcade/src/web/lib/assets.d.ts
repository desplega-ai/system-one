// Bun's HTML bundle serves imported images as files. The import gives their URL.
declare module "*.jpg" {
  const url: string;
  export default url;
}
