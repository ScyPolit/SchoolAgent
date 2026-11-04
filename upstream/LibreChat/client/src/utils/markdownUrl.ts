import { defaultUrlTransform } from 'react-markdown';

/** Match the upstream skills renderer: telephone links are allowed while every
 * other protocol retains react-markdown's default URL protections. */
export function schoolMarkdownUrlTransform(value: string): string {
  return /^tel:/i.test(value) ? value : defaultUrlTransform(value);
}
