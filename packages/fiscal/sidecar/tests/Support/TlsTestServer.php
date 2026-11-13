<?php

declare(strict_types=1);

namespace Fiscal\Sidecar\Tests\Support;

use RuntimeException;

/**
 * `tls-server.php` as a child process, with a throwaway CA and a server
 * certificate for 127.0.0.1 made for the run and deleted with it.
 */
final class TlsTestServer
{
    /** @var resource */
    private $process;

    private function __construct(public readonly int $port, public readonly string $folder)
    {
    }

    public static function start(string $mode): self
    {
        $folder = sys_get_temp_dir() . '/fiscal-sidecar-tls-' . bin2hex(random_bytes(6));
        mkdir($folder, 0700);
        self::certificates($folder);
        $socket = stream_socket_server('tcp://127.0.0.1:0');
        $name = (string) stream_socket_get_name($socket ?: throw new RuntimeException('No port.'), false);
        fclose($socket);
        $self = new self((int) substr($name, strrpos($name, ':') + 1), $folder);
        $process = proc_open(
            [PHP_BINARY, __DIR__ . '/tls-server.php', $mode, $folder, (string) $self->port],
            [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
            $pipes,
        );
        if (!is_resource($process)) {
            throw new RuntimeException('Cannot start the TLS server.');
        }
        $self->process = $process;
        if (trim((string) fgets($pipes[1])) !== 'listening') {
            throw new RuntimeException('The TLS server did not start: ' . stream_get_contents($pipes[2]));
        }
        return $self;
    }

    public function url(): string
    {
        return "https://127.0.0.1:{$this->port}/ws";
    }

    public function caFile(): string
    {
        return "{$this->folder}/ca.pem";
    }

    public function stop(): void
    {
        proc_terminate($this->process, 9);
        proc_close($this->process);
        exec('rm -rf ' . escapeshellarg($this->folder));
    }

    private static function certificates(string $folder): void
    {
        $config = "$folder/openssl.cnf";
        file_put_contents($config, "[req]\ndistinguished_name = dn\n[dn]\n[ca]\nbasicConstraints = critical, CA:TRUE\nkeyUsage = keyCertSign, cRLSign\n[server]\nbasicConstraints = CA:FALSE\nsubjectAltName = IP:127.0.0.1\nextendedKeyUsage = serverAuth\n");
        $caKey = openssl_pkey_new(['private_key_bits' => 2048, 'config' => $config]);
        $caCsr = openssl_csr_new(['commonName' => 'Test CA'], $caKey, ['config' => $config]);
        $ca = openssl_csr_sign($caCsr, null, $caKey, 2, ['config' => $config, 'x509_extensions' => 'ca', 'digest_alg' => 'sha256'], 1);
        $key = openssl_pkey_new(['private_key_bits' => 2048, 'config' => $config]);
        $csr = openssl_csr_new(['commonName' => '127.0.0.1'], $key, ['config' => $config]);
        $cert = openssl_csr_sign($csr, $ca, $caKey, 2, ['config' => $config, 'x509_extensions' => 'server', 'digest_alg' => 'sha256'], 2);
        openssl_x509_export($ca, $caPem);
        openssl_x509_export($cert, $certPem);
        openssl_pkey_export($key, $keyPem);
        file_put_contents("$folder/ca.pem", $caPem);
        file_put_contents("$folder/server.pem", $certPem . $keyPem);
    }
}
