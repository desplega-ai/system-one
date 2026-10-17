// Bun's HTML bundle serves imported images as files. The import gives their URL.
declare module "*.jpg" {
  const url: string;
  export default url;
}

// CSS imported from TSX joins the page's stylesheet.
declare module "*.css";

declare module "*.svg" {
  const url: string;
  export default url;
}

declare module "*.png" {
  const url: string;
  export default url;
}
