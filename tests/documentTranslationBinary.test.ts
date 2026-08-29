import {readFileSync} from 'node:fs';

import JSZip from 'jszip';
import {PDFDocument} from 'pdf-lib';
import {describe, expect, it} from 'vitest';

import {
    getDocumentAcceptAttribute,
    getDocumentFormat,
    getDocumentMimeType,
} from '@/src/features/document-translation/core/document';
import {
    createDocumentDownload,
    parseBinaryDocument,
    parseDocumentFile,
    type PdfPageRasterizer,
} from '@/src/features/document-translation/services/binary';

const exampleRoot = new URL('../examples/document-translation/', import.meta.url);
const onePixelPng = Uint8Array.from(Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlY4AAAAASUVORK5CYII=',
    'base64',
));
const testRasterizer: PdfPageRasterizer = async () => onePixelPng;

function loadBytes(fileName: string): Uint8Array {
    return Uint8Array.from(readFileSync(new URL(fileName, exampleRoot)));
}

function copyArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return buffer;
}

describe('binary document translation formats', () => {
    it('识别 PDF、ePub、DOCX 并提供正确 MIME 与上传 accept', () => {
        expect(getDocumentFormat('paper.PDF')).toBe('pdf');
        expect(getDocumentFormat('book.epub')).toBe('epub');
        expect(getDocumentFormat('brief.docx')).toBe('docx');
        expect(getDocumentMimeType('pdf')).toBe('application/pdf');
        expect(getDocumentMimeType('epub')).toBe('application/epub+zip');
        expect(getDocumentMimeType('docx')).toContain('wordprocessingml.document');
        expect(getDocumentAcceptAttribute()).toContain('.pdf');
        expect(getDocumentAcceptAttribute()).toContain('.epub');
        expect(getDocumentAcceptAttribute()).toContain('.docx');
    });

    it('按 PDF 页解析版面文本块、坐标和页码上下文', async () => {
        const parsed = await parseBinaryDocument('sample.pdf', loadBytes('sample.pdf'));

        expect(parsed.format).toBe('pdf');
        expect(parsed.binary?.kind).toBe('pdf');
        expect(parsed.binary?.kind === 'pdf' && parsed.binary.pages).toHaveLength(2);
        const firstPage = parsed.binary?.kind === 'pdf' ? parsed.binary.pages[0] : undefined;
        expect(firstPage?.blocks.length).toBeGreaterThan(2);
        expect(firstPage?.blocks.every((block) => block.width > 0 && block.height > 0)).toBe(true);
        expect(firstPage?.blocks.every((block) => block.lineCount >= 1 && block.lineHeight > 0)).toBe(true);
        expect(firstPage?.blocks.some((block) => block.lineCount > 1)).toBe(true);
        expect(firstPage?.blocks.every((block) => block.x >= 0 && block.y >= 0)).toBe(true);
        expect(firstPage?.blocks.some((block) => block.x < (firstPage?.width || 0) * 0.42)).toBe(true);
        expect(firstPage?.blocks.some((block) => block.x > (firstPage?.width || 0) * 0.5)).toBe(true);
        expect(parsed.segments.some((segment) => segment.source.includes('Document Translation Example'))).toBe(true);
        expect(parsed.segments.some((segment) => segment.contextLabel === '第 1 页')).toBe(true);
        expect(parsed.segments.some((segment) => segment.contextLabel === '第 2 页')).toBe(true);
    });

    it('按 ePub spine 章节提取 XHTML，并导出仍可读取的双语 ePub', async () => {
        const parsed = await parseBinaryDocument('sample.epub', loadBytes('sample.epub'));
        expect(parsed.format).toBe('epub');
        expect(parsed.binary?.kind === 'epub' && parsed.binary.chapters).toHaveLength(2);
        expect(parsed.segments.some((segment) => segment.contextLabel === 'BabelBox reading')).toBe(true);

        const translations = parsed.segments.map((segment) => `译文：${segment.source}`);
        const download = await createDocumentDownload(parsed, translations, 'bilingual');
        const zip = await JSZip.loadAsync(download.data as Uint8Array);
        expect(await zip.file('mimetype')!.async('string')).toBe('application/epub+zip');
        const chapter = await zip.file('OEBPS/chapter-1.xhtml')!.async('string');
        expect(chapter).toContain('BabelBox reading for local books');
        expect(chapter).toContain('译文：BabelBox reading for local books');
        expect(chapter).toContain('data-babelbox-document-translation="true"');
        const linkedChapter = await zip.file('OEBPS/chapter-2.xhtml')!.async('string');
        expect(linkedChapter).toContain('href="chapter-1.xhtml"');
        expect(linkedChapter.match(/<title>/gu)).toHaveLength(1);
        expect(linkedChapter).not.toContain('<title>译文：');
    });

    it('ePub 章节的文本实体以可读文本翻译并保留原 XHTML 表达', async () => {
        const zip = new JSZip();
        zip.file('mimetype', 'application/epub+zip', {compression: 'STORE'});
        zip.file('META-INF/container.xml', [
            '<container><rootfiles>',
            '<rootfile full-path="OEBPS/content.opf"/>',
            '</rootfiles></container>',
        ].join(''));
        zip.file('OEBPS/content.opf', [
            '<package><manifest>',
            '<item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>',
            '</manifest><spine><itemref idref="chapter"/></spine></package>',
        ].join(''));
        zip.file('OEBPS/chapter.xhtml', [
            '<html><head><title>Entities</title></head><body>',
            '<p>Hello&#160;world &amp; friends</p>',
            '</body></html>',
        ].join(''));
        const bytes = await zip.generateAsync({type: 'uint8array'});

        const parsed = await parseBinaryDocument('entities.epub', bytes);
        expect(parsed.segments.map((segment) => segment.source)).toEqual(['Hello\u00a0world & friends']);

        const download = await createDocumentDownload(parsed, ['你好世界与朋友'], 'bilingual');
        const exportedZip = await JSZip.loadAsync(download.data as Uint8Array);
        const chapter = await exportedZip.file('OEBPS/chapter.xhtml')!.async('string');
        expect(chapter).toContain('Hello&#160;world &amp; friends');
        expect(chapter).not.toContain('Hello&amp;#160;world');
        expect(chapter).toContain('你好世界与朋友');
    });

    it('提取 DOCX 正文、页眉和页脚，并保持 OOXML 包可重新解析', async () => {
        const parsed = await parseBinaryDocument('sample.docx', loadBytes('sample.docx'));
        expect(parsed.format).toBe('docx');
        expect(parsed.binary?.kind).toBe('docx');
        expect(parsed.segments.some((segment) => segment.source.includes('Document Translation Example'))).toBe(true);
        expect(parsed.segments.some((segment) => segment.contextLabel === '页眉')).toBe(true);
        expect(parsed.segments.some((segment) => segment.role === 'heading')).toBe(true);
        expect(parsed.segments.some((segment) => segment.pathLabel === '正文')).toBe(true);

        const translations = parsed.segments.map((segment) => `Translated ${segment.id + 1}: ${segment.source}`);
        const download = await createDocumentDownload(parsed, translations, 'bilingual');
        const zip = await JSZip.loadAsync(download.data as Uint8Array);
        expect(zip.file('[Content_Types].xml')).not.toBeNull();
        const documentXml = await zip.file('word/document.xml')!.async('string');
        expect(documentXml).toContain('Document Translation Example');
        expect(documentXml).toContain('Translated');
        const headerXml = await zip.file('word/header1.xml')!.async('string');
        const footerXml = await zip.file('word/footer1.xml')!.async('string');
        expect(headerXml).toContain('Translated');
        expect(footerXml).toContain('Translated');

        const reparsed = await parseBinaryDocument('sample.bilingual.docx', download.data as Uint8Array);
        expect(reparsed.segments.length).toBeGreaterThan(parsed.segments.length);
    });

    it('DOCX 仅译文导出不会重复原段落的换行和制表符', async () => {
        const zip = new JSZip();
        zip.file('[Content_Types].xml', '<Types/>');
        zip.file('word/document.xml', [
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r>',
            '<w:t>Hello</w:t><w:br/><w:t>World</w:t><w:cr/><w:t>More</w:t><w:tab/><w:t>Again</w:t>',
            '</w:r></w:p></w:body></w:document>',
        ].join(''));
        const bytes = await zip.generateAsync({type: 'uint8array'});
        const parsed = await parseBinaryDocument('line-breaks.docx', bytes);

        expect(parsed.segments[0].source).toBe('Hello\nWorld\nMore\tAgain');
        const download = await createDocumentDownload(parsed, ['你好\n世界\n更多\t继续'], 'translated');
        const exportedZip = await JSZip.loadAsync(download.data as Uint8Array);
        const documentXml = await exportedZip.file('word/document.xml')!.async('string');

        expect(documentXml.match(/<w:br\s*\/>/gu)).toHaveLength(2);
        expect(documentXml).not.toContain('<w:cr');
        expect(documentXml.match(/<w:tab\s*\/>/gu)).toHaveLength(1);
        expect(documentXml).toMatch(/更多<\/w:t><w:tab\/><w:t xml:space="preserve">继续/u);
        expect(documentXml).not.toContain('Hello');
        expect(documentXml).not.toContain('World');
        expect(documentXml).not.toContain('More');
        expect(documentXml).not.toContain('Again');
    });

    it('PDF 双语导出将每张原页和保留版式的译页并排放在同一页', async () => {
        const parsed = await parseBinaryDocument('sample.pdf', loadBytes('sample.pdf'));
        const translations = parsed.segments.map((segment) => `Translated: ${segment.source}`);
        const download = await createDocumentDownload(parsed, translations, 'bilingual', {
            pdfPageRasterizer: testRasterizer,
        });

        expect(download.fileName).toBe('sample.bilingual.pdf');
        const exported = await PDFDocument.load(download.data as Uint8Array);
        expect(exported.getPageCount()).toBe(2);
        const sourcePage = parsed.binary?.kind === 'pdf' ? parsed.binary.pages[0] : undefined;
        const exportedSize = exported.getPage(0).getSize();
        expect(exportedSize.width).toBeGreaterThan((sourcePage?.width || 0) * 2);
        expect(exportedSize.height).toBeCloseTo(sourcePage?.height || 0, 2);
    });

    it('统一文件入口根据扩展名选择文本或二进制解析器', async () => {
        const bytes = loadBytes('sample.epub');
        const parsed = await parseDocumentFile({
            name: 'sample.epub',
            text: async () => 'not used',
            arrayBuffer: async () => copyArrayBuffer(bytes),
        });
        expect(parsed.format).toBe('epub');
        expect(parsed.segments.length).toBeGreaterThan(0);
    });

    it('拒绝扩展名伪装或损坏的二进制文件', async () => {
        await expect(parseBinaryDocument('broken.pdf', new TextEncoder().encode('not a pdf'))).rejects.toThrow('PDF 文件签名无效');
        await expect(parseBinaryDocument('broken.epub', new TextEncoder().encode('not a zip'))).rejects.toThrow('ePub 解析失败');
        await expect(parseBinaryDocument('broken.docx', new TextEncoder().encode('not a zip'))).rejects.toThrow('DOCX 解析失败');
    });

    it('扫描版或空白 PDF 不会产生空译文，而是提示需要文字层或 OCR', async () => {
        const pdf = await PDFDocument.create();
        pdf.addPage([320, 480]);

        await expect(parseBinaryDocument('scanned.pdf', await pdf.save())).rejects.toThrow(
            '扫描版 PDF 暂不支持 OCR',
        );
    });

    it('拒绝解压后单项过大的 ePub/DOCX 压缩包', async () => {
        const zip = new JSZip();
        zip.file('oversized.txt', 'x'.repeat(24 * 1024 * 1024 + 1));
        const bytes = await zip.generateAsync({type: 'uint8array', compression: 'DEFLATE'});

        await expect(parseBinaryDocument('oversized.epub', bytes)).rejects.toThrow('单个内容项过大');
        await expect(parseBinaryDocument('oversized.docx', bytes)).rejects.toThrow('单个内容项过大');
    });
});
