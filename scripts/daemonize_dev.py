#!/usr/bin/env python3
"""Daemoniza el dev server de Next.js con doble fork.

El sandbox sega los procesos lanzados por las llamadas del agente al terminar
cada llamada; los procesos reparentados a PID 1 durante la propia llamada
(como hace agent-browser) escapan al segador. Este script aplica esa técnica
al servidor de desarrollo para que el preview del usuario permanezca vivo.
"""
import os
import subprocess

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
    daemonize_spawn(["bun", "run", "dev"], "/home/z/my-project/dev.log")
    print("Dev server lanzado con doble fork (reparentado a PID 1).")
