import React, { useCallback, useEffect, useMemo, useState } from "react"
import {
  VStack,
  Input,
  Button,
  HStack,
  Box,
  Card,
  CardBody,
  CardHeader,
  Heading,
  Text,
} from "@chakra-ui/react"
import useChildActorEvent from "../../hooks/useChildActorEvent"

function LightningDevTools(props) {
  const { removeAllCredentialsToStore } = useChildActorEvent()

  const [error, setError] = useState("")

  // on mount
  useEffect(() => {}, [])

  const handleSubmitAllDelete = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      removeAllCredentialsToStore()
    },
    []
  )

  return (
    <Box bg="tomato" m={5} color="white">
      <VStack align="flex-start">
        <Heading size="md">Dev Tools</Heading>
        <VStack>
          <form onSubmit={handleSubmitAllDelete}>
            <Button
              type="submit"
              variant="outline"
              colorScheme="teal"
              aria-label=""
            >
              All Delete
            </Button>
          </form>
        </VStack>
      </VStack>
    </Box>
  )
}

export default LightningDevTools
