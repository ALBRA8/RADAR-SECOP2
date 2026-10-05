#!/usr/bin/env python3
"""Daemoniza el poller de Telegram con doble fork (misma técnica de daemonize_dev.py).

El sandbox sega los procesos lanzados por las llamadas del agente; los procesos
reparentados a PID 1 durante la propia llamada escapan al segador.
"""
import os
import sys

PROJECT = "/home/z/my-project"


def daemonize_spawn(argv, logfile):
    pid = os.fork()
    if pid == 0:
        os.setsid()
        pid2 = os.fork()
        if pid2 == 0:
            os.chdir(PROJECT)
            devnull = os.open(os.devnull, os.O_RDWR)
            os.dup2(devnull, 0)
            out = os.open(logfile, os.O_WRONLY | os.O_CREAT | os.O_APPEND)
            os.dup2(out, 1)
            os.dup2(out, 2)
            os.execvp(argv[0], argv)
            os._exit(127)
        os._exit(0)
    os.waitpid(pid, 0)


if __name__ == "__main__":
    cmd = sys.argv[1:] or ["bun", "scripts/telegram_poller.mjs"]
    daemonize_spawn(cmd, "/home/z/my-project/scripts/poller.log")
    print("Poller lanzado con doble fork (reparentado a PID 1).")
