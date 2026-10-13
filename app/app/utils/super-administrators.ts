import emails from '../../../shared/super-administrators.json'
export const isSuperAdministratorEmail = (email: string) => emails.includes(email.trim().toLowerCase())
