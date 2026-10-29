export const PASSWORD_RECOVERY_PREFIX = 'password-recovery:';
export const PASSWORD_RECOVERY_MESSAGE = 'If this email belongs to an active account, a recovery request is now available to your company directors. Contact a director to verify your identity and receive a new password.';
export const passwordRecoveryKey = (userId: string) => `${PASSWORD_RECOVERY_PREFIX}${userId}`;
