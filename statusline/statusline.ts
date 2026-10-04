#!/usr/bin/env bun
// Claude Code statusLine command: reads the session JSON on stdin, prints one line.

import { gitInfo } from './git'
import { render, type StatusInput } from './segments'

let input: StatusInput = {}
try {
  input = JSON.parse(await Bun.stdin.text()) as StatusInput
} catch {}
const cwd = input.workspace?.current_dir ?? input.cwd
process.stdout.write(render(input, { git: cwd ? gitInfo(cwd) : undefined }))
