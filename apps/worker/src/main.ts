function main() {
  const stage = process.env.QDOC_STAGE ?? 'v1-foundation'
  console.log(`[worker] ready for async jobs (${stage})`)
}

main()
