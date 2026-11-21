// Session token (JWT) kept in localStorage for MVP. The backend issues it on SIWS verify.
const KEY = 'sa_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setToken(t: string) {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* private mode */
  }
}

export function clearToken() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* */
  }
}
