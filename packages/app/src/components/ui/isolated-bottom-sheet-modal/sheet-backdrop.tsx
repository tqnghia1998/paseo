import { BottomSheetBackdrop, type BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { scrimOpacity } from "@/styles/scrim";

/**
 * What a backdrop tap does. `dismiss` takes the top modal off the stack and unmounts it; `close`
 * only slides this sheet down, so a sheet that keeps its content through a close can veto it.
 */
export type SheetBackdropPress = "dismiss" | "close";

export function SheetBackdrop({
  pressBehavior: _pressBehavior,
  ...props
}: BottomSheetBackdropProps & { opacity?: number; pressBehavior: SheetBackdropPress }) {
  // Gorhom's native backdrop closes its own sheet, which here is always the top one. It is black and animates
  // its own opacity; the wrapper scales it with the canvas (styles/scrim.ts).
  return (
    <View style={styles.scrimStrength} pointerEvents="box-none">
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  scrimStrength: {
    ...StyleSheet.absoluteFill,
    opacity: scrimOpacity(theme.scrimStrength),
  },
}));
