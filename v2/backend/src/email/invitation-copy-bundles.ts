// Copied from the web app's translations (i18n/*.json: invitations.email and
// team.roles), which the previous API imported directly.
export const invitationCopyBundles = {
  de: {
    email: {
      subject: "{{inviterName}} hat dich eingeladen, {{workspaceName}} auf Kaneo beizutreten",
      preview: "Du wurdest zu {{workspaceName}} auf Kaneo eingeladen",
      title: "{{workspaceName}} beitreten",
      subtitle: "{{inviterName}} ({{inviterEmail}}) hat dich eingeladen, in Kaneo zusammenzuarbeiten.",
      cta: "Einladung annehmen",
      sameEmail: "Du kannst die Einladung mit derselben E-Mail-Adresse annehmen, die diese Nachricht erhalten hat.",
      ignore: "Falls du damit nicht gerechnet hast, kannst du diese E-Mail einfach ignorieren.",
      footer: "Kaneo Workspace-Einladung",
      details: {
        title: "Einladungsdetails",
        sentTo: "Gesendet an",
        instance: "Instanz",
        role: "Rolle",
        expires: "Läuft ab"
      }
    },
    roles: {
      owner: "Eigentümer",
      admin: "Admin",
      member: "Mitglied",
      viewer: "Betrachter"
    }
  },
  en: {
    email: {
      subject: "{{inviterName}} invited you to join {{workspaceName}} on Kaneo",
      preview: "You're invited to {{workspaceName}} on Kaneo",
      title: "Join {{workspaceName}}",
      subtitle: "{{inviterName}} ({{inviterEmail}}) invited you to collaborate in Kaneo.",
      cta: "Accept invitation",
      sameEmail: "You can accept with the same email that received this message.",
      ignore: "If this wasn't expected, you can safely ignore this email.",
      footer: "Kaneo workspace invitation",
      details: {
        title: "Invitation details",
        sentTo: "Sent to",
        instance: "Instance",
        role: "Role",
        expires: "Expires"
      }
    },
    roles: {
      owner: "Owner",
      admin: "Admin",
      member: "Member",
      viewer: "Viewer"
    }
  },
  fr: {
    email: {
      subject: "{{inviterName}} vous invite à rejoindre {{workspaceName}} sur Kaneo",
      preview: "Vous êtes invité à rejoindre {{workspaceName}} sur Kaneo",
      title: "Rejoindre {{workspaceName}}",
      subtitle: "{{inviterName}} ({{inviterEmail}}) vous invite à collaborer sur Kaneo.",
      cta: "Accepter l’invitation",
      sameEmail: "Vous pouvez accepter l’invitation avec l’adresse e-mail qui a reçu ce message.",
      ignore: "Si vous ne vous attendiez pas à recevoir ce message, vous pouvez l’ignorer.",
      footer: "Invitation à un espace de travail Kaneo",
      details: {
        title: "Détails de l’invitation",
        sentTo: "Envoyée à",
        instance: "Instance",
        role: "Rôle",
        expires: "Expire"
      }
    },
    roles: {
      owner: "Propriétaire",
      admin: "Admin",
      member: "Membre",
      viewer: "Observateur"
    }
  },
  ja: {
    email: {
      subject: "{{inviterName}} さんが Kaneo の「{{workspaceName}}」にあなたを招待しました",
      preview: "Kaneo の「{{workspaceName}}」に招待されました",
      title: "「{{workspaceName}}」に参加",
      subtitle: "{{inviterName}} ({{inviterEmail}}) さんが Kaneo でのコラボレーションにあなたを招待しました。",
      cta: "招待を承諾",
      sameEmail: "このメッセージを受信したメールアドレスで承諾できます。",
      ignore: "心当たりがない場合は、このメールを無視していただいて構いません。",
      footer: "Kaneo ワークスペース招待",
      details: {
        title: "招待の詳細",
        sentTo: "送信先",
        instance: "インスタンス",
        role: "ロール",
        expires: "有効期限"
      }
    },
    roles: {
      owner: "オーナー",
      admin: "管理者",
      member: "メンバー",
      viewer: "閲覧者"
    }
  },
  pt: {
    email: {
      subject: "{{inviterName}} convidou você para participar de {{workspaceName}} no Kaneo",
      preview: "Você foi convidado para {{workspaceName}} no Kaneo",
      title: "Entrar em {{workspaceName}}",
      subtitle: "{{inviterName}} ({{inviterEmail}}) convidou você para colaborar no Kaneo.",
      cta: "Aceitar convite",
      sameEmail: "Você pode aceitar com o mesmo e-mail que recebeu esta mensagem.",
      ignore: "Se isso não era esperado, você pode ignorar este e-mail com segurança.",
      footer: "Convite para espaço de trabalho do Kaneo",
      details: {
        title: "Detalhes do convite",
        sentTo: "Enviado para",
        instance: "Instância",
        role: "Função",
        expires: "Expira"
      }
    },
    roles: {
      owner: "Proprietário",
      admin: "Administrador",
      member: "Membro",
      viewer: "Visualizador"
    }
  },
  vi: {
    email: {
      subject: "{{inviterName}} đã mời bạn tham gia {{workspaceName}} trên Kaneo",
      preview: "Bạn được mời tham gia {{workspaceName}} trên Kaneo",
      title: "Tham gia {{workspaceName}}",
      subtitle: "{{inviterName}} ({{inviterEmail}}) đã mời bạn cộng tác trên Kaneo.",
      cta: "Chấp nhận lời mời",
      sameEmail: "Bạn có thể chấp nhận bằng email đã nhận thư này.",
      ignore: "Nếu bạn không mong đợi email này, bạn có thể yên tâm bỏ qua.",
      footer: "Lời mời không gian làm việc Kaneo",
      details: {
        title: "Chi tiết lời mời",
        sentTo: "Gửi đến",
        instance: "Máy chủ",
        role: "Vai trò",
        expires: "Hết hạn"
      }
    },
    roles: {
      owner: "Chủ sở hữu",
      admin: "Quản trị viên",
      member: "Thành viên",
      viewer: "Người xem"
    }
  },
  zhTW: {
    email: {
      subject: "{{inviterName}} 邀請你加入 Kaneo 上的 {{workspaceName}}",
      preview: "你受邀加入 Kaneo 上的 {{workspaceName}}",
      title: "加入 {{workspaceName}}",
      subtitle: "{{inviterName}}（{{inviterEmail}}）邀請你在 Kaneo 上協作。",
      cta: "接受邀請",
      sameEmail: "請使用收到這封郵件的同一個電子郵件地址接受邀請。",
      ignore: "如果你沒有預期收到這封郵件，請直接忽略。",
      footer: "Kaneo 工作區邀請",
      details: {
        title: "邀請詳細資料",
        sentTo: "寄送至",
        instance: "執行個體",
        role: "角色",
        expires: "到期時間"
      }
    },
    roles: {
      owner: "擁有者",
      admin: "管理員",
      member: "成員",
      viewer: "檢視者"
    }
  },
} as const;
