function getLocaleKey(locale?: string | null) {
  const normalized = locale?.toLowerCase();
  if (normalized?.startsWith("de")) return "de";
  if (normalized?.startsWith("vi")) return "vi";
  if (normalized?.startsWith("ja")) return "ja";
  if (normalized === "zh-tw") return "zh-tw";
  return "en";
}

/** Subjects of the sign-in and recovery emails, in the recipient's language. */
export function getAuthEmailCopy(locale?: string | null) {
  const localeKey = getLocaleKey(locale);

  if (localeKey === "de") {
    return {
      magicLinkSubject: "Anmeldelink für Kaneo",
      otpSubject: (otp: string) => `${otp} ist dein Kaneo-Anmeldecode`,
      passwordResetSubject: "Kaneo-Passwort zurücksetzen",
    };
  }

  if (localeKey === "vi") {
    return {
      magicLinkSubject: "Liên kết đăng nhập Kaneo",
      otpSubject: (otp: string) => `${otp} là mã đăng nhập Kaneo của bạn`,
      passwordResetSubject: "Đặt lại mật khẩu Kaneo",
    };
  }

  if (localeKey === "ja") {
    return {
      magicLinkSubject: "Kaneo ログインリンク",
      otpSubject: (otp: string) => `Kaneo のサインインコード: ${otp}`,
      passwordResetSubject: "Kaneo のパスワードをリセット",
    };
  }

  if (localeKey === "zh-tw") {
    return {
      magicLinkSubject: "Kaneo 登入連結",
      otpSubject: (otp: string) => `你的 Kaneo 登入驗證碼：${otp}`,
      passwordResetSubject: "重設 Kaneo 密碼",
    };
  }

  return {
    magicLinkSubject: "Login for Kaneo",
    otpSubject: (otp: string) => `${otp} is your Kaneo sign-in code`,
    passwordResetSubject: "Reset your Kaneo password",
  };
}
