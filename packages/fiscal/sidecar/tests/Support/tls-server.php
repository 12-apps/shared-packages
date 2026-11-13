<?php

declare(strict_types=1);

/*
 * A TLS server that misbehaves on purpose, for the transport tests:
 *   php tls-server.php <mode> <folder> <port>
 * <folder> holds server.pem (certificate + key) and ca.pem. Modes:
 *   never-accept       listens and never accepts: the handshake never happens
 *   drop-after-upload  reads the whole request, then closes without a word
 *   hang-after-upload  reads the whole request, then says nothing
 *   refuse-client-cert demands a client certificate signed by ca.pem
 *   answer-403         answers HTTP 403 with an HTML page
 *   answer-200         answers HTTP 200 with a SOAP body
 */

[, $mode, $folder, $port] = $argv;
$context = stream_context_create(['ssl' => [
    'local_cert' => "$folder/server.pem",
    'verify_peer' => $mode === 'refuse-client-cert',
    'verify_peer_name' => false,
    'cafile' => "$folder/ca.pem",
    'crypto_method' => STREAM_CRYPTO_METHOD_TLSv1_2_SERVER,
]]);
$server = stream_socket_server("tcp://127.0.0.1:$port", $errno, $error, STREAM_SERVER_BIND | STREAM_SERVER_LISTEN, $context);
if ($server === false) {
    fwrite(STDERR, "cannot listen: $error\n");
    exit(1);
}
fwrite(STDOUT, "listening\n");
if ($mode === 'never-accept') {
    sleep(60);
    exit(0);
}
while (true) {
    $client = @stream_socket_accept($server, 60);
    if ($client === false) {
        continue;
    }
    if (!@stream_socket_enable_crypto($client, true, STREAM_CRYPTO_METHOD_TLSv1_2_SERVER)) {
        fclose($client);
        continue;
    }
    $request = '';
    while (!str_contains($request, "\r\n\r\n")) {
        $request .= (string) fread($client, 8192);
    }
    preg_match('/Content-Length: (\d+)/i', $request, $length);
    $body = substr($request, strpos($request, "\r\n\r\n") + 4);
    while (strlen($body) < (int) ($length[1] ?? 0)) {
        $body .= (string) fread($client, 8192);
    }
    match ($mode) {
        'drop-after-upload' => null,
        'hang-after-upload' => sleep(30),
        'answer-403' => fwrite($client, "HTTP/1.1 403 Forbidden\r\nContent-Type: text/html\r\nContent-Length: 13\r\nConnection: close\r\n\r\n<h1>403</h1>\n"),
        default => fwrite($client, "HTTP/1.1 200 OK\r\nContent-Type: application/soap+xml\r\nContent-Length: 19\r\nConnection: close\r\n\r\n<ok><cStat/></ok>\n\n"),
    };
    fclose($client);
}
