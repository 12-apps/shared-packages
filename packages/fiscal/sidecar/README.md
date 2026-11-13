# The fiscal service (`sidecar/`)

A thin, stateless HTTP door in front of
[`nfephp-org/sped-nfe`](https://github.com/nfephp-org/sped-nfe), a PHP library
that builds, signs and transmits NF-e (model 55) and NFC-e (model 65). It ships
inside `@12-apps/fiscal` with its own `Dockerfile`, so a host builds the image
from the version it pins:

```bash
docker build -t fiscal-sidecar node_modules/@12-apps/fiscal/sidecar
```

The TypeScript side of the contract is in the same package:
`@12-apps/fiscal/sale` (the document, `SaleForDocument`),
`@12-apps/fiscal/sidecar` (each endpoint's request and answer, the error
classes) and `@12-apps/fiscal/sidecar/schema/sale-for-document.schema.json`
(the JSON schema this service validates every document against).

## Endpoints

JSON in, JSON out. `<model>` is `nfe` or `nfce`. Every call that talks to
SEFAZ carries `environment` (`homologacao` | `producao`) and `certificate`
(`{ pfxBase64, password }`, the A1).

| endpoint | does | answers |
|---|---|---|
| `POST /<model>/issue` | `{ environment, certificate, csc, document }`: builds, signs and transmits. `csc` (`{ id, token }`) is required for `nfce` and must be `null` for `nfe`. | `AUTHORIZED`: `accessKey`, `protocol`, `authorizedAt`, `signedXml`, `authorizedXml` (the `nfeProc`), `statusCode`, `statusReason`, `sefazReply` |
| `POST /nfce/sign-contingency` | the same, plus `contingency: { since, reason }`; builds and signs with `tpEmis = 9`, sends nothing | `SIGNED`: `accessKey`, `signedXml` |
| `POST /<model>/transmit` | `{ environment, certificate, signedXml }` | as `/issue` |
| `POST /<model>/cancel` | `{ environment, certificate, accessKey, protocol, reason }` | `CANCELLED`: the event's `protocol`, `registeredAt`, `eventXml` |
| `POST /<model>/lookup` | `{ environment, certificate, accessKey }` | `AUTHORIZED`, `CANCELLED`, `DENIED` or `NOT_FOUND`, with the authorisation `protocol` |
| `POST /inutilize` | `{ environment, certificate, model, uf, cnpj, year, series, from, to, reason }` | `INUTILIZED`: `protocol`, `registeredAt`, `inutilizationXml` |
| `GET /health` | | `{ status: "ok", libraries, nfeSchemas }` |

The UF and the issuer of `cancel` and `lookup` are read from the access key.
The `document.keyCode` (`cNF`) is the caller's, drawn once and kept, so a
retried `issue` yields the same key.

## Errors

Every failure is `{ error: { class, code, message, details, accessKey, signedXml, sefazReply } }`:

| class | HTTP | when |
|---|---|---|
| `REJECTED` | 422 | SEFAZ said no; `code` is its `cStat`. A denial of use (110, 301, 302) is one too: the number is spent. |
| `RETRYABLE` | 503 | try again: a timeout (the outcome is unknown, so look the key up first), a receipt with no protocol yet (103, 105), rate limiting (656), 999, a reply with no status. |
| `CONTINGENCY` | 503 | SEFAZ is stopped (108, 109) or unreachable while issuing: an NFC-e goes offline through `/nfce/sign-contingency`. Outside issuing, unreachable is `RETRYABLE`. |
| `AUTH` | 401 | the `.pfx` does not open (wrong password, not PKCS#12), the certificate expired, SEFAZ refused it at TLS (HTTP 403) or by code (213, 280–286, 290–294). |
| `INVALID` | 400 | the request is malformed: the schema, a missing CSC, an XML the layout's XSD refuses. Never retry it as is. |

When the call got as far as signing, `accessKey` and `signedXml` come back
with the error: the key is spoken for, and an NFC-e can be signed offline.

## Stateless, and quiet about secrets

- The certificate, its password and the CSC arrive with each call and leave
  with it. The kernel is built per request; no class holds static state.
- Nothing is written to disk. sped-common's own SOAP transport writes the
  private key to a temporary folder before every request; this service gives
  cURL the key in memory instead (`CURLOPT_SSLKEY_BLOB`). The image runs with a
  read-only root filesystem (Apache's pid needs a tmpfs at `/var/run/apache2`).
- The request log is one JSON line per call on stderr: time, method, path,
  status, duration, error class and SEFAZ code. Nothing read from the body is
  ever in it, and stack traces carry no arguments
  (`zend.exception_ignore_args`).

## Configuration

| variable | default | |
|---|---|---|
| `FISCAL_SEFAZ_TIMEOUT_SECONDS` | `30` | connect timeout; the whole request gets 20 s more |
| `FISCAL_SEFAZ_CA_BUNDLE` | unset | a PEM of the ICP-Brasil roots. Set, SEFAZ's server certificate is verified against it; unset, it is not, which is sped-nfe's own default |

The image listens on 8080 as `www-data`, and its `HEALTHCHECK` calls `/health`.
OpenSSL's legacy provider is on, because most A1 files issued before 2023 are
encrypted with RC2-40.

## A second library

Each library is a `Module` that registers its own paths
(`src/Nfe/NfeModule.php`). An NFS-e library is a second module, with its
`/nfse/...` paths, appended in `Kernel::modules()`; the router refuses a path
registered twice.

## Tests

```bash
composer install            # in this folder
vendor/bin/phpunit --testsuite unit
vendor/bin/phpunit --testsuite live   # skips without the variables below
```

The unit suite needs no certificate: it makes a throwaway self-signed A1 in
the test (never written to the repository), validates the signed XML against
the schema package's XSD, plays recorded SEFAZ replies
(`tests/fixtures/sefaz/`), boots the service with `php -S` to read its request
log after a wrong password, and checks that no call writes a file.

The live suite runs the acceptance against SEFAZ homologação with a real A1 of
a CNPJ accredited for NFC-e: `FISCAL_TEST_PFX_BASE64`,
`FISCAL_TEST_PFX_PASSWORD`, `FISCAL_TEST_CSC`, `FISCAL_TEST_CSC_ID`,
`FISCAL_TEST_CNPJ`, `FISCAL_TEST_UF`; optionally `FISCAL_TEST_IE`,
`FISCAL_TEST_MUNICIPALITY_IBGE`, `FISCAL_TEST_MUNICIPALITY`,
`FISCAL_TEST_TAX_REGIME`, `FISCAL_TEST_SERIES` (default 889), and
`FISCAL_TEST_BASE_URL` to drive a running service. Mutual TLS cannot cross an
intercepting proxy, so run it where the machine reaches SEFAZ directly.

## Versions

sped-nfe `5.2.9`, schema package `PL_010_V1.30` (Pacote de Liberação 010f: NT
2025.002 v1.50 and NT 2026.007 v1.00). NT 2026.008's `vProdLiq` and
`vProdLiqTot`, needed when the IBS/CBS move inside `vProd` in 2027, are on
sped-nfe's `master` after 5.2.9 and arrive with its next release.
