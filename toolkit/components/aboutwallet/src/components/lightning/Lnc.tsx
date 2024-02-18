import React, { useCallback, useEffect, useMemo, useState } from "react"
import {
  Box,
  Flex,
  VStack,
  HStack,
  Input,
  ButtonGroup,
  Button,
  IconButton,
  Switch,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Heading,
  Text,
  StackDivider,
  Spinner,
} from "@chakra-ui/react"
import { MdSend } from "react-icons/md"
import useLNC from "../../hooks/useLNC"
import useChildActorEvent from "../../hooks/useChildActorEvent"

function Lnc(props) {
  const {
    lightningCredentials,
    initStore,
    addCredentialToStore,
    modifyCredentialToStore,
    deleteCredentialToStore,
  } = useChildActorEvent()
  const { connect, preload } = useLNC()

  const [phrase, setPhrase] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const lncCredential = useMemo(() => {
    const val = lightningCredentials.filter(
      (credential) => credential.credentialName === "lnc"
    )[0]
    if (val) {
      setPhrase(val.secret)
    }
    return val
  }, [lightningCredentials])
  const nodeInfo = useMemo(
    () => lncCredential && lncCredential.properties.nodeInfo,
    [lncCredential]
  )
  const ready = useMemo(() => !!lncCredential, [lncCredential])

  // on mount
  useEffect(() => {
    initStore()
    preload()
  }, [])

  const handleConnect = (
    e: React.MouseEvent<HTMLButtonElement, MouseEvent>
  ) => {
    e.preventDefault()

    // communicate with LND
    connectAsync()
  }

  const handleSubmitPhrase = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    // communicate with LND
    connectAsync()
  }

  const connectAsync = useCallback(async () => {
    try {
      setLoading(true)
      setError("")
      if (!phrase) throw new Error("Enter a phrase")

      // connect to the litd node via LNC
      const nodeInfo = await connect(phrase)
      if (
        !lncCredential ||
        lncCredential.secret !== phrase ||
        lncCredential.identifier !== nodeInfo.identityPubkey ||
        lncCredential.properties.nodeInfo != nodeInfo
      ) {
        await addCredentialToStore(phrase, nodeInfo.identityPubkey, nodeInfo)
      }
    } catch (err) {
      setError((err as Error).message)
      // tslint:disable-next-line: no-console
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [phrase])

  return (
    <VStack align="flex-start">
      <Heading size="md">LNC (Lightning Node Connect)</Heading>
      {loading && <Spinner size="xl" />}
      <VStack>
        {!ready ? (
          <form onSubmit={handleSubmitPhrase}>
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
          <Card minW="md">
            <CardHeader>
              <Text fontSize="sm" textTransform="uppercase">
                {nodeInfo.chains[0].chain} {nodeInfo.chains[0].network}
              </Text>
              <Heading size="md">{nodeInfo.alias || "NO NAME"}</Heading>
            </CardHeader>
            <CardBody>
              {loading ? (
                <Spinner size="sm" />
              ) : (
                <>
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
                </>
              )}
            </CardBody>
            <CardFooter pt="0" justify="space-evenly">
              {!loading && (
                <>
                  <Flex gap="2">
                    <Switch
                      isChecked={lncCredential.primary}
                      onChange={(e) =>
                        modifyCredentialToStore({
                          ...lncCredential,
                          primary: e.target.checked,
                        })
                      }
                      alignSelf="center"
                    />
                    {lncCredential.primary && <Text>primary now</Text>}
                  </Flex>
                  <Button
                    variant="outline"
                    colorScheme="blue"
                    onClick={handleConnect}
                  >
                    Connect
                  </Button>
                  <Button
                    variant="ghost"
                    colorScheme="blue"
                    onClick={() => deleteCredentialToStore(lncCredential)}
                  >
                    Delete
                  </Button>
                </>
              )}
            </CardFooter>
          </Card>
        )}
      </VStack>
    </VStack>
  )
}

export default Lnc
