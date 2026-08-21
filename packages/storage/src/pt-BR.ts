import type { StorageMessageContext, StorageMessages } from './problems';

/**
 * The pt-BR pack — a NAMED factory a host passes by hand
 * (`messages: PT_BR_STORAGE_MESSAGES`), never a default. The filename is what
 * exempts this file from the copy-portability gate: Portuguese may ship, it
 * may not be silent. `limit` is interpolated rather than hard-coded so a
 * host that raises `maxBytes` cannot end up with a message naming the old
 * number — the single commonest way this kind of copy goes stale.
 */
export function PT_BR_STORAGE_MESSAGES(context: StorageMessageContext): StorageMessages {
  return {
    invalid_base64: 'A imagem enviada não está codificada corretamente em base64.',
    empty_file: 'A imagem enviada está vazia.',
    file_too_large: `A imagem enviada é maior que o limite de ${context.limit}.`,
    content_mismatch:
      'O conteúdo da imagem não corresponde ao formato informado. Envie um PNG, JPEG, WebP ou GIF.',
    unsupported_content_type: 'Formato não suportado. Envie PNG, JPG, WebP ou GIF.',
    image_unreadable:
      'Não foi possível ler a imagem enviada — o arquivo parece estar corrompido.',
    image_dimensions_too_large:
      'A imagem enviada tem dimensões grandes demais para ser processada.',
    storage_not_configured: 'O armazenamento de imagens ainda não foi configurado nesta loja.',
    storage_unavailable:
      'Não foi possível salvar a imagem agora. Tente novamente em instantes.',
  };
}

/** The 401 the mounted router answers when the host resolves no actor. */
export const PT_BR_STORAGE_UNAUTHENTICATED = 'Não autenticado.';
