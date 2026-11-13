# syntax=docker/dockerfile:1
#
# The fiscal service: PHP 8.3 + Apache over sped-nfe. Build context: this
# folder (`sidecar/`), as shipped inside the @12-apps/fiscal tarball.
#
#   docker build -t fiscal-sidecar node_modules/@12-apps/fiscal/sidecar
#
# Both images are pinned BY DIGEST; the tag beside each digest is only a label.
# A digest is bumped on purpose, never by a rebuild.

# The dependencies are installed in Composer's own image (it has git and unzip)
# and only `vendor/` is carried over. The two requirements it cannot meet
# itself, PHP 8.3 and ext-soap, are the final image's, which has both.
FROM composer:2.8.12@sha256:5248900ab8b5f7f880c2d62180e40960cd87f60149ec9a1abfd62ac72a02577c AS vendor
WORKDIR /app
COPY composer.json composer.lock ./
# The service's own classes go into the authoritative classmap too.
COPY src ./src
RUN composer install \
        --no-dev --no-interaction --no-progress --prefer-dist \
        --classmap-authoritative --no-scripts \
        --ignore-platform-req=php --ignore-platform-req=ext-soap

FROM php:8.3.36-apache-bookworm@sha256:a14446c32a3c8aeb9b4dac7fb73b03dfd8006e670d9b43ea7947e4030d3cbae6

# ext-soap is a declared requirement of sped-nfe (the service talks SOAP over
# its own cURL transport, but the library's constants come from the extension).
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends libxml2-dev; \
    docker-php-ext-install -j"$(nproc)" soap; \
    apt-get purge -y --auto-remove libxml2-dev; \
    rm -rf /var/lib/apt/lists/*

COPY docker/php.ini /usr/local/etc/php/conf.d/zz-fiscal-sidecar.ini
COPY docker/openssl.cnf /etc/ssl/fiscal-sidecar-openssl.cnf
COPY docker/apache.conf /etc/apache2/sites-available/000-default.conf
# A1 certificates issued before OpenSSL 3 are encrypted with RC2/3DES, which
# only the legacy provider reads. The config turns it on beside the default.
ENV OPENSSL_CONF=/etc/ssl/fiscal-sidecar-openssl.cnf
RUN set -eux; \
    cp /usr/local/etc/php/php.ini-production /usr/local/etc/php/php.ini; \
    sed -ri 's/^Listen 80$/Listen 8080/' /etc/apache2/ports.conf; \
    printf 'ServerTokens Prod\nServerSignature Off\nTraceEnable Off\n' > /etc/apache2/conf-available/zz-fiscal-sidecar.conf; \
    a2enconf zz-fiscal-sidecar

WORKDIR /app
COPY --from=vendor /app/vendor ./vendor
COPY public ./public
COPY src ./src
COPY schema ./schema

USER www-data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD php -r 'exit(@file_get_contents("http://127.0.0.1:8080/health") === false ? 1 : 0);'
