import React, { useCallback, useEffect, useState } from "react"
import { VStack, Input, IconButton, HStack } from "@chakra-ui/react"
import { MdSend } from "react-icons/md"
import useLNC from "../../hooks/useLNC"

function Lnc(props) {
  const { lnc, connect } = useLNC()

  const [phrase, setPhrase] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    // preload the WASM file when this component is mounted
    lnc.preload()
  }, [lnc])

  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      // wrap LNC calls into an async function
      const connectAsync = async () => {
        e.preventDefault()
        try {
          setLoading(true)
          setError("")
          if (!phrase || !password)
            throw new Error("Enter a phrase and password")

          // connect to the litd node via LNC
          await connect(phrase, password)
        } catch (err) {
          setError((err as Error).message)
          // tslint:disable-next-line: no-console
          console.error(err)
        } finally {
          setLoading(false)
        }
      }
      connectAsync()
    },
    [phrase, password, connect]
  )

  return (
    <VStack align="flex-start">
      <div>LNC(Lightning Node Connect)</div>
      <VStack>
        <form onSubmit={handleSubmit}>
          <Input
            placeholder="Password"
            width="200px"
            onChange={(e) => setPassword(e.target.value)}
          />
          <HStack spacing={1}>
            <Input
              placeholder="Pairing Phrase of Ligtning terminal"
              width="400px"
              onChange={(e) => setPhrase(e.target.value)}
            />
            <IconButton
              type="submit"
              variant="outline"
              colorScheme="teal"
              aria-label="regist Pairing Phrase"
              icon={<MdSend />}
            />
          </HStack>
        </form>
      </VStack>
    </VStack>
  )
}

export default Lnc
