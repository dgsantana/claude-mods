#!/usr/bin/env bun
// Claude Code statusLine command: reads the session JSON on stdin, prints one line.

import { homedir } from 'node:os'
import { cavemanDir, readCaveman } from './caveman'
import { loadStatusline } from './config'
import { gitInfo } from './git'
import { render, type StatusInput } from './segments'

let input: StatusInput = {}
try {
  input = JSON.parse(await Bun.stdin.text()) as StatusInput
} catch {}
const cwd = input.workspace?.current_dir ?? input.cwd
const env = process.env
const { config, theme } = await loadStatusline(input, env)
process.stdout.write(
  render(input, {
    git: cwd ? gitInfo(cwd) : undefined,
    caveman: readCaveman(cavemanDir(env), env),
    config,
    theme,
    truecolor: /^(truecolor|24bit)$/i.test(env.COLORTERM ?? ''),
    home: env.USERPROFILE || env.HOME || homedir(),
  }),
)
