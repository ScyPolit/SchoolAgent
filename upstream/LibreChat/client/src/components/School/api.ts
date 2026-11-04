import { useQuery } from '@tanstack/react-query';
import { useAuthContext } from '~/hooks/AuthContext';

export type SchoolContent =
  | string
  | {
      title?: string;
      content?: string;
      text?: string;
      question?: string;
      answer?: string;
      description?: string;
      image?: string;
      url?: string;
      agentId?: string;
      groups?: string[];
    };
export type SchoolAgent = {
  id: string;
  name: string;
  description: string;
  avatar: string;
  category: string;
  questions: string[];
  recommended: boolean;
};
export type SchoolUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  permissions: string[];
};
export type SchoolBootstrap = {
  user: SchoolUser | null;
  guestMigrationCount: number;
  development: boolean;
  agents: SchoolAgent[];
  retention: { guestBrowserDays: number };
  homepage: {
    schoolName: string;
    platformName: string;
    welcome: string;
    subtitle: string;
    help: string;
    contact: string;
    footer: string;
    logo: string;
    modules: Record<string, boolean>;
    announcements: SchoolContent[];
    banners: SchoolContent[];
    questions: SchoolContent[];
    faq: SchoolContent[];
  };
};
export type SchoolRow = {
  id: string;
  name?: string;
  email?: string;
  title?: string;
  role?: string;
  permissions?: string[];
  groupIds?: string[];
  active?: boolean;
  members?: string[];
  [key: string]: unknown;
};
export const schoolKeys = {
  bootstrap: ['school', 'bootstrap'],
  catalog: ['school', 'catalog'],
  admin: (key: string) => ['school', 'admin', key],
};
export async function schoolRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${response.status}`);
  return data as T;
}
export function useSchoolBootstrap() {
  const { user } = useAuthContext();
  return useQuery<SchoolBootstrap>(
    [...schoolKeys.bootstrap, user?.id || 'anonymous', user?.provider || 'unknown'],
    () => schoolRequest('/bootstrap'),
    { staleTime: 0, refetchOnWindowFocus: false, retry: false },
  );
}
export function canSchool(user: SchoolUser | null | undefined, permission: string) {
  return (
    user?.role === 'superadmin' || (user?.role === 'admin' && user.permissions.includes(permission))
  );
}
export function contentText(content: SchoolContent) {
  return typeof content === 'string'
    ? content
    : content.title || content.text || content.content || content.question || '';
}
export function safeSchoolHref(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value, location.origin);
    return ['http:', 'https:', 'tel:', 'mailto:'].includes(url.protocol) ? value : undefined;
  } catch {
    return undefined;
  }
}
export async function schoolDownload(path: string, filename?: string) {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin' });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const match =
    disposition.match(/filename\*=UTF-8''([^;]+)/i) || disposition.match(/filename="?([^";]+)/i);
  const serverName = match ? decodeURIComponent(match[1]) : filename || 'conversation.md';
  const extension = serverName.match(/\.[a-z0-9]+$/i)?.[0] || '';
  const name = filename ? filename.replace(/\.(md|pdf|png|zip)$/i, '') + extension : serverName;
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
}
