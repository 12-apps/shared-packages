import type { WebStorageMessageContext, WebStorageMessages } from './failures';

/**
 * The pt-BR pack — a NAMED factory a host passes by hand, never a default.
 * `limit` is interpolated rather than hard-coded for the same reason the
 * server pack does it: a host that raises the ceiling must not end up with
 * copy naming the old number. The filename is what exempts this file from
 * the copy-portability gate: Portuguese may ship, it may not be silent.
 */
export function PT_BR_WEB_STORAGE_MESSAGES(
  context: WebStorageMessageContext,
): WebStorageMessages {
  return {
    forbidden: 'Sua conta não tem permissão para enviar imagens nesta loja.',
    unsupported_content_type: 'Formato não suportado. Envie PNG, JPG, WebP ou GIF.',
    file_too_large: `Imagem muito grande. O limite é ${context.limit}.`,
    invalid_key: 'Não foi possível localizar essa imagem.',
    not_found: 'Essa imagem não está mais disponível.',
    session_expired: 'Sua sessão expirou. Entre novamente e repita o envio.',
    transport: 'Não foi possível falar com o servidor. Verifique sua conexão e tente de novo.',
    empty_file: 'Arquivo vazio (0 bytes). Escolha a imagem novamente.',
    file_too_large_upfront: ({ size, limit }) =>
      `Imagem muito grande: ${size}. O limite é ${limit} — reduza a imagem e tente de novo.`,
    unknown_content_type:
      'Não foi possível identificar o tipo do arquivo. Envie um PNG, JPG ou WebP.',
    unsupported_content_type_upfront: ({ contentType }) =>
      `Formato não suportado (${contentType}). Envie PNG, JPG, WebP ou GIF.`,
    missing_key: 'O servidor aceitou a imagem mas não devolveu a chave. Tente de novo.',
    upload_failed_http: ({ status, detail }) =>
      `Não foi possível enviar a imagem (HTTP ${status}${detail}). Tente de novo em instantes.`,
    upload_failed: 'Falha ao enviar a imagem. Tente de novo em instantes.',

    pageTitle: 'Imagens da loja',
    pageIntro: `Envie um PNG, JPG, WebP ou GIF de até ${context.limit}.`,
    fieldLabel: 'Foto do produto',
    fieldHelper: 'A imagem é reduzida no navegador antes do envio.',
    fieldRemove: 'Remover imagem',
    field: {
      // `buttonLabel` is never read here — `ImageField` overrides it with
      // `fieldLabel`. It is still answered, because the type is the whole of
      // what `UploadButton` may render and a partial answer is not a pack.
      buttonLabel: 'Foto do produto',
      dropzoneHint: 'Solte a imagem aqui ou clique para escolher',
      dropzoneRole: (label) => `Área de upload de imagem. ${label}`,
      uploading: 'Enviando…',
      dropReady: 'Imagem pronta para soltar',
      percentUploaded: (percent) => `${percent}% enviado`,
      uploadInProgress: (percent) => `Envio em andamento: ${percent}%`,
      errorAnnouncement: (message) => `Erro: ${message}`,
    },
  };
}
