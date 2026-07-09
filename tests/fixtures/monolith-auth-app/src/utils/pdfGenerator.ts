/**
 * UNRELATED to the auth flow.
 *
 * A self-contained PDF document builder. It has deep internal structure but
 * imports NOTHING from the auth chain (no crypto, no jwtUtils). A pruner
 * focused on "Fix JWT verification" must slice this entire file away.
 *
 * Dependency edges: billing -> pdfGenerator (only). Nothing in the auth chain
 * references this module.
 */

export interface PdfSection {
  heading: string;
  lines: string[];
}

export interface PdfDocument {
  title: string;
  author: string;
  sections: PdfSection[];
}

interface PdfObject {
  id: number;
  body: string;
}

/**
 * Renders a PdfDocument into a minimal (but syntactically real) PDF byte
 * stream string. This is intentionally verbose to give the AST traversal
 * something meaty and clearly unrelated to slice off.
 */
export function renderPdf(doc: PdfDocument): string {
  const builder = new PdfBuilder();
  builder.beginDocument(doc.title, doc.author);

  for (const section of doc.sections) {
    builder.addSection(section);
  }

  return builder.finalize();
}

class PdfBuilder {
  private objects: PdfObject[] = [];
  private contentStreams: string[] = [];
  private cursorY = 792;

  beginDocument(title: string, author: string): void {
    this.pushObject(`<< /Type /Catalog /Pages 2 0 R /Title (${escapePdf(title)}) /Author (${escapePdf(author)}) >>`);
    this.pushObject(`<< /Type /Pages /Kids [3 0 R] /Count 1 >>`);
  }

  addSection(section: PdfSection): void {
    this.emitLine(section.heading, 18);
    this.cursorY -= 6;
    for (const line of section.lines) {
      this.emitLine(line, 11);
    }
    this.cursorY -= 18;
  }

  finalize(): string {
    const content = this.contentStreams.join("\n");
    this.pushObject(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`
    );
    this.pushObject(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    this.pushObject(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`);

    const header = "%PDF-1.4";
    const body = this.objects
      .map((obj) => `${obj.id} 0 obj\n${obj.body}\nendobj`)
      .join("\n");
    const trailer = `trailer\n<< /Root 1 0 R /Size ${this.objects.length + 1} >>\n%%EOF`;

    return [header, body, trailer].join("\n");
  }

  private emitLine(text: string, fontSize: number): void {
    this.contentStreams.push(
      `BT /F1 ${fontSize} Tf 72 ${this.cursorY} Td (${escapePdf(text)}) Tj ET`
    );
    this.cursorY -= fontSize + 4;
  }

  private pushObject(body: string): number {
    const id = this.objects.length + 1;
    this.objects.push({ id, body });
    return id;
  }
}

function escapePdf(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
