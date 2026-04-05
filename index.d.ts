export = link_preview_generator;

declare function link_preview_generator(
    uri: string,
    puppeteerArgs?: string[],
    puppeteerAgent?: string,
    executablePath?: string,
    screenshot?: boolean | ScreenshotCaptureOptions
): Promise<LinkPreviewResult>;

declare interface ScreenshotCaptureOptions {
    path?: string;
    /** When `path` is set, skip `screenshot` buffer on the result unless `true`. @default true */
    returnBuffer?: boolean;
    /** Extra wait after network idle (ms), for late layout/paint. @default 0 */
    extraDelayMs?: number;
    /** @default 'networkidle2' when screenshot is enabled */
    gotoWaitUntil?: "load" | "domcontentloaded" | "networkidle0" | "networkidle2";
    /** @default 120000 when screenshot is enabled */
    gotoTimeout?: number;
    /** @default true */
    fullPage?: boolean;
    type?: "png" | "jpeg" | "webp";
    quality?: number;
    captureBeyondViewport?: boolean;
    clip?: { x: number; y: number; width: number; height: number };
}

declare interface LinkPreviewResult {
    title: string | null;
    description: string | null;
    domain: string;
    img: string | null;
    favicon: string | null;
    screenshot?: Buffer;
    screenshotPath?: string;
}
