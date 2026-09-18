import { mainPerformance } from './index'

/**
 * Records the Main-side end of a document read, including encoding detection,
 * BOM handling, decoding and line-ending normalization.
 *
 * `mainPerformance.mark` already keeps only the first timestamp, so repeated
 * document opens share one phase boundary: the point where this run first had
 * decoded content in hand. Reporting read completion separately from the
 * renderer's parse and first-paint markers is what lets a report distinguish
 * "the disk read was slow" from "parsing/rendering was slow".
 */
export const markDocumentReadComplete = (): void => {
  mainPerformance.mark('document-read-complete')
}
