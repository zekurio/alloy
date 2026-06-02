import os
import sys
from ipaddress import ip_address
from urllib.error import URLError
from urllib.request import urlopen

port = os.getenv("ALLOY_ML_PORT", "2662")
host = os.getenv("ALLOY_ML_HOST", "0.0.0.0")


def is_ipv6(value: str) -> bool:
    try:
        return ip_address(value).version == 6
    except ValueError:
        return False


if host == "0.0.0.0":
    host = "localhost"
if host == "::":
    host = "::1"
if is_ipv6(host):
    host = f"[{host}]"

try:
    with urlopen(f"http://{host}:{port}/ping", timeout=2) as response:
        sys.exit(0 if response.status == 200 else 1)
except (OSError, URLError):
    sys.exit(1)
