<?php

declare(strict_types=1);

namespace Fiscal\Sidecar\Tests\Support;

use RuntimeException;

/**
 * A self-signed A1 made for one test run: an RSA key, a certificate that
 * carries the CNPJ where ICP-Brasil puts it (otherName 2.16.76.1.3.3), wrapped
 * as a PKCS#12 with a random password. Nothing about it is real, and nothing
 * of it is committed: the files it needs live in a temporary folder that is
 * removed before `create()` returns.
 */
final class ThrowawayCertificate
{
    private function __construct(
        public readonly string $pfx,
        public readonly string $password,
        public readonly string $cnpj,
    ) {
    }

    public static function create(string $cnpj = '11222333000181', int $validDays = 30): self
    {
        $folder = sys_get_temp_dir() . '/fiscal-sidecar-test-' . bin2hex(random_bytes(6));
        if (!mkdir($folder, 0700)) {
            throw new RuntimeException('Cannot create a temporary folder for the test certificate.');
        }
        $config = "$folder/openssl.cnf";
        file_put_contents($config, implode("\n", [
            '[req]',
            'distinguished_name = dn',
            '[dn]',
            '[a1]',
            'basicConstraints = CA:FALSE',
            'keyUsage = digitalSignature, nonRepudiation, keyEncipherment',
            'subjectAltName = otherName:2.16.76.1.3.3;PRINTABLESTRING:' . $cnpj,
            '',
        ]));
        try {
            $options = ['config' => $config, 'digest_alg' => 'sha256', 'x509_extensions' => 'a1'];
            $key = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA] + $options);
            $csr = openssl_csr_new(['commonName' => "TEST COMPANY:$cnpj", 'countryName' => 'BR'], $key, $options);
            $x509 = openssl_csr_sign($csr, null, $key, $validDays, $options, random_int(1, PHP_INT_MAX));
            $password = bin2hex(random_bytes(12));
            $pfx = '';
            if ($x509 === false || !openssl_pkcs12_export($x509, $pfx, $key, $password)) {
                throw new RuntimeException('Cannot build the test certificate: ' . (string) openssl_error_string());
            }
            return new self($pfx, $password, $cnpj);
        } finally {
            @unlink($config);
            @rmdir($folder);
        }
    }

    public function base64(): string
    {
        return base64_encode($this->pfx);
    }
}
