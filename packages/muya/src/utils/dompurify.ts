import type { Config } from 'dompurify';
import DOMPurify from 'dompurify';

const purify = DOMPurify();
function sanitize(dirty: string | Node, config?: Config): string {
    return purify.sanitize(dirty, config);
}
const { isValidAttribute } = purify;

export { Config, isValidAttribute };

export default sanitize;
