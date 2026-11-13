<?php

declare(strict_types=1);

namespace Fiscal\Sidecar\Tests\Support;

use RuntimeException;

/**
 * The service as a real process: `php -S` over a front controller, its stderr
 * (where the request log goes) captured, and a TMPDIR of its own so a test can
 * see whether it wrote anything there.
 */
final class ServiceProcess
{
    /** @var resource */
    private $process;
    /** @var resource */
    private $stderr;
    private string $captured = '';

    private function __construct(public readonly int $port, public readonly string $tmpdir)
    {
    }

    public static function start(string $frontController): self
    {
        $root = dirname(__DIR__, 2);
        $tmpdir = sys_get_temp_dir() . '/fiscal-sidecar-tmp-' . bin2hex(random_bytes(6));
        mkdir($tmpdir, 0700);
        $port = self::freePort();
        $self = new self($port, $tmpdir);
        $env = ['TMPDIR' => $tmpdir, 'PATH' => (string) getenv('PATH')];
        $process = proc_open(
            [PHP_BINARY, '-d', 'display_errors=stderr', '-S', "127.0.0.1:$port", '-t', "$root/public", $frontController],
            [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
            $pipes,
            $root,
            $env,
        );
        if (!is_resource($process)) {
            throw new RuntimeException('Cannot start php -S.');
        }
        $self->process = $process;
        $self->stderr = $pipes[2];
        stream_set_blocking($self->stderr, false);
        $self->waitUntilListening();
        return $self;
    }

    /**
     * @param array<string, mixed>|null $body
     * @return array{status: int, body: array<string, mixed>}
     */
    public function call(string $method, string $path, ?array $body = null): array
    {
        $curl = curl_init("http://127.0.0.1:{$this->port}$path");
        curl_setopt_array($curl, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 30,
            CURLOPT_PROXY => '',
            CURLOPT_NOPROXY => '*',
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        ]);
        if ($body !== null) {
            curl_setopt($curl, CURLOPT_POSTFIELDS, (string) json_encode($body));
        }
        $answer = (string) curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
        curl_close($curl);
        return ['status' => $status, 'body' => (array) json_decode($answer, true)];
    }

    /** Everything the process wrote to stderr so far, waiting for `$expected` to appear. */
    public function log(string $expected = '', float $seconds = 5.0): string
    {
        $deadline = microtime(true) + $seconds;
        do {
            $chunk = fread($this->stderr, 65536);
            if (is_string($chunk) && $chunk !== '') {
                $this->captured .= $chunk;
                continue;
            }
            if ($expected === '' || str_contains($this->captured, $expected)) {
                break;
            }
            usleep(20_000);
        } while (microtime(true) < $deadline);
        return $this->captured;
    }

    /** @return list<string> the files the process left in its TMPDIR */
    public function tmpFiles(): array
    {
        $files = [];
        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($this->tmpdir, \FilesystemIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::SELF_FIRST,
        );
        foreach ($iterator as $entry) {
            $files[] = substr((string) $entry, strlen($this->tmpdir));
        }
        return $files;
    }

    public function stop(): void
    {
        proc_terminate($this->process);
        proc_close($this->process);
        exec('rm -rf ' . escapeshellarg($this->tmpdir));
    }

    private function waitUntilListening(): void
    {
        $deadline = microtime(true) + 10;
        while (microtime(true) < $deadline) {
            $socket = @fsockopen('127.0.0.1', $this->port, $errno, $error, 0.2);
            if ($socket !== false) {
                fclose($socket);
                return;
            }
            usleep(50_000);
        }
        throw new RuntimeException('php -S did not start: ' . $this->log());
    }

    private static function freePort(): int
    {
        $socket = stream_socket_server('tcp://127.0.0.1:0');
        if ($socket === false) {
            throw new RuntimeException('No free port.');
        }
        $name = (string) stream_socket_get_name($socket, false);
        fclose($socket);
        return (int) substr($name, strrpos($name, ':') + 1);
    }
}
