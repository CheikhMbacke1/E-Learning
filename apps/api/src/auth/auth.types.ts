export interface AuthUser {
  id: string;
  email: string;
  status: string;
  sessionId: string;
  roles: string[];
  permissions: string[];
}
