#!/usr/bin/env python3
import argparse
import signal
import socket
import threading


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Small TCP relay for local host bridging.")
    parser.add_argument("--listen-host", default="0.0.0.0")
    parser.add_argument("--listen-port", type=int, required=True)
    parser.add_argument("--target-host", required=True)
    parser.add_argument("--target-port", type=int, required=True)
    parser.add_argument("--label", default="tcp-relay")
    return parser.parse_args()


def relay_bytes(source: socket.socket, destination: socket.socket) -> None:
    try:
        while True:
            data = source.recv(65536)
            if not data:
                break
            destination.sendall(data)
    except OSError:
        pass
    finally:
        try:
            destination.shutdown(socket.SHUT_WR)
        except OSError:
            pass
        try:
            source.close()
        except OSError:
            pass


def handle_connection(
    client: socket.socket,
    address: tuple[str, int],
    target_host: str,
    target_port: int,
    label: str,
) -> None:
    try:
        upstream = socket.create_connection((target_host, target_port), timeout=10)
    except OSError as error:
        print(f"[{label}] connect_fail {address} {error}", flush=True)
        client.close()
        return

    print(f"[{label}] connect {address}", flush=True)
    threading.Thread(target=relay_bytes, args=(client, upstream), daemon=True).start()
    threading.Thread(target=relay_bytes, args=(upstream, client), daemon=True).start()


def main() -> None:
    args = parse_args()
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind((args.listen_host, args.listen_port))
    listener.listen()
    listener.settimeout(1.0)

    stop_event = threading.Event()

    def request_stop(_signum: int, _frame: object) -> None:
        stop_event.set()

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)

    print(
        f"[{args.label}] listening {args.listen_host}:{args.listen_port} -> "
        f"{args.target_host}:{args.target_port}",
        flush=True,
    )

    try:
        while not stop_event.is_set():
            try:
                client, address = listener.accept()
            except TimeoutError:
                continue
            except OSError:
                if stop_event.is_set():
                    break
                raise
            threading.Thread(
                target=handle_connection,
                args=(client, address, args.target_host, args.target_port, args.label),
                daemon=True,
            ).start()
    finally:
        listener.close()


if __name__ == "__main__":
    main()
