/** OCR 识别出的单行文本及其原图像素坐标。 */
export interface OcrLine {
    text: string;
    bbox: {
        x0: number;
        y0: number;
        x1: number;
        y1: number;
    };
}
