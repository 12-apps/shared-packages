<?php

declare(strict_types=1);

// The image installs ext-soap; a workstation may not. sped-nfe only reads the
// constant's value on the paths these tests take.
if (!defined('SOAP_1_2')) {
    define('SOAP_1_2', 2);
}

require dirname(__DIR__) . '/vendor/autoload.php';
