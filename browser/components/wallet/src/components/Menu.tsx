import React, { useState, useEffect, useCallback } from "react"
import { VStack, Button } from "@chakra-ui/react"
import { MdElectricBolt } from "react-icons/md"
import { GiBirdTwitter } from "react-icons/gi"
import BitcoinIcon from "./bitcoin/Logo"

function Menu(props) {
  return (
    <VStack>
      <Button
        variant="transparent"
        leftIcon={<BitcoinIcon />}
        onClick={() => props.setMenu("bitcoin")}
      >
        Bitcoin
      </Button>
      <Button
        variant="transparent"
        leftIcon={<MdElectricBolt />}
        onClick={() => props.setMenu("lightning")}
      >
        Lightning
      </Button>
      <Button
        variant="transparent"
        leftIcon={<GiBirdTwitter />}
        onClick={() => props.setMenu("nostr")}
      >
        Nostr
      </Button>
    </VStack>
  )
}

export default Menu
