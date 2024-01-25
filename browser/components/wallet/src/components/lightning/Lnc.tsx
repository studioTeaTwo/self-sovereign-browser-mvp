import React, { useCallback, useEffect, useState } from "react"
import {
  VStack,
  Input,
  IconButton,
  HStack,
  Box,
  Card,
  CardBody,
  CardHeader,
  Heading,
  Text,
} from "@chakra-ui/react"
import { MdSend } from "react-icons/md"
import useLNC from "../../hooks/useLNC"

function Lnc(props) {
  const { lnc, connect, load } = useLNC()

  const [phrase, setPhrase] = useState("")
  const [password, setPassword] = useState("")
  const [nodeInfo, setNodeInfo] = useState({
    identityPubkey: "",
    alias: "",
    numActiveChannels: 0,
  })
  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    const initialize = async () => {
      // preload the WASM file when this component is mounted
      lnc.preload()

      const data = load()
      setPassword(data.password)
      if (data.pairingPhrase) {
        setPhrase(data.pairingPhrase)
        connectAsync()
      }
    }
    initialize()
  }, [lnc])

  const handleSubmitPhrase = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      connectAsync()
    },
    [phrase, password, connect]
  )

  // wrap LNC calls into an async function
  const connectAsync = async () => {
    try {
      setLoading(true)
      setError("")
      if (!phrase || !password) throw new Error("Enter a phrase and password")

      // connect to the litd node via LNC
      const nodeInfo = await connect(phrase, password)
      setNodeInfo(nodeInfo)
      setReady(true)
    } catch (err) {
      setError((err as Error).message)
      // tslint:disable-next-line: no-console
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <VStack align="flex-start">
      <div>LNC (Lightning Node Connect)</div>
      <VStack>
        {!ready ? (
          <form onSubmit={handleSubmitPhrase}>
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
        ) : (
          <Card>
            <CardHeader>
              <Heading size="md">{nodeInfo.alias}</Heading>
            </CardHeader>
            <CardBody>
              <Box>
                <Heading size="xs" textTransform="uppercase">
                  pubkey
                </Heading>
                <Text fontSize="sm">{nodeInfo.identityPubkey}</Text>
              </Box>
              <Box>
                <Heading size="xs" textTransform="uppercase">
                  channels
                </Heading>
                <Text fontSize="sm">{nodeInfo.numActiveChannels}</Text>
              </Box>
            </CardBody>
          </Card>
        )}
      </VStack>
    </VStack>
  )
}

export default Lnc
